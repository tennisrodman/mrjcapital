from ipaddress import ip_address
import logging
import uuid
from uuid import UUID

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import connection, IntegrityError, transaction
from django.db.models import Count, Max, Sum
from django.db.models.deletion import ProtectedError
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError as DRFValidationError
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.response import Response

from api.models import (
    ActivityActionType,
    ActivityLog,
    Broker,
    Deal,
    DealNote,
    DealProperty,
    DealStageEvent,
    Document,
    DocumentStorageStatus,
    Fund,
    PipelineStatus,
    Property,
    Sponsor,
)
from api.serializers import (
    ActivityLogSerializer,
    BrokerSerializer,
    DealCreateSerializer,
    DealNoteSerializer,
    DealPropertySerializer,
    DealSerializer,
    DealStageEventSerializer,
    DocumentDownloadSerializer,
    DocumentSerializer,
    DocumentUploadCompleteSerializer,
    DocumentUploadIntentSerializer,
    FundSerializer,
    PipelineTransitionSerializer,
    PropertySerializer,
    SensitiveFieldReadSerializer,
    SponsorSerializer,
    SyndicationTransitionSerializer,
    _can_attach_property,
)
from api.services import (
    allowed_pipeline_statuses,
    allowed_syndication_statuses,
    create_note,
    log_sensitive_field_read,
    normalize_address,
    transition_pipeline_status,
    transition_syndication_status,
)
from api.services.storage import (
    PresignedDownload,
    PresignedUpload,
    build_document_key,
    get_document_storage,
    max_upload_bytes,
    sanitize_filename,
    sha256_hex,
)

logger = logging.getLogger(__name__)


class SponsorViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = SponsorSerializer
    queryset = Sponsor.objects.all()
    sensitive_defer_fields = ['ein', 'guarantor_net_worth', 'guarantor_liquidity', 'guarantor_credit_score']

    def get_queryset(self):
        queryset = super().get_queryset().defer(*self.sensitive_defer_fields)
        if not _is_staff_user(self.request.user):
            queryset = queryset.filter(deals__assigned_analyst=self.request.user).distinct()
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(entity_name__icontains=search)
        rating = self.request.query_params.get('relationship_rating')
        if rating:
            queryset = queryset.filter(relationship_rating=rating)
        return queryset

    @action(detail=True, methods=['post'], url_path='sensitive-fields')
    def sensitive_fields(self, request, pk=None):
        if not _is_staff_user(request.user):
            raise PermissionDenied('Only staff may read encrypted sponsor fields.')
        sponsor = self.get_object()
        serializer = SensitiveFieldReadSerializer(data=request.data, context={'sponsor': sponsor})
        serializer.is_valid(raise_exception=True)
        try:
            values = log_sensitive_field_read(
                sponsor=sponsor,
                fields=serializer.validated_data['fields'],
                performed_by=request.user,
                reason=serializer.validated_data['reason'],
                deal=serializer.validated_data.get('deal'),
                ip_address=_client_ip(request),
            )
        except DjangoValidationError as exc:
            return _django_validation_response(exc)
        return Response({'sponsor': str(sponsor.pk), 'fields': values})


class BrokerViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = BrokerSerializer
    queryset = Broker.objects.all()

    def get_queryset(self):
        queryset = super().get_queryset()
        if not _is_staff_user(self.request.user):
            queryset = queryset.filter(deals__assigned_analyst=self.request.user).distinct()
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(company_name__icontains=search)
        status_param = self.request.query_params.get('status')
        if status_param:
            queryset = queryset.filter(status=status_param)
        return queryset


class FundViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = FundSerializer
    queryset = Fund.objects.all()

    def get_queryset(self):
        queryset = super().get_queryset()
        if not _is_staff_user(self.request.user):
            queryset = queryset.filter(deals__assigned_analyst=self.request.user).distinct()
        status_param = self.request.query_params.get('status')
        if status_param:
            queryset = queryset.filter(status=status_param)
        return queryset


class PropertyViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = PropertySerializer
    queryset = Property.objects.all()

    def get_queryset(self):
        queryset = super().get_queryset()
        if not _is_staff_user(self.request.user):
            queryset = queryset.filter(deal_properties__deal__assigned_analyst=self.request.user).distinct()
        for field in ['city', 'state', 'property_type', 'msa', 'address_normalized']:
            value = self.request.query_params.get(field)
            if value:
                queryset = queryset.filter(**{field: value.upper() if field == 'state' else value})
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(address__icontains=search)
        return queryset

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            # If ATOMIC_REQUESTS is enabled later, keep this in an inner atomic savepoint.
            self.perform_create(serializer)
        except IntegrityError:
            return _property_integrity_response(
                serializer.validated_data.get('address_normalized'),
                user=request.user,
            )
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def update(self, request, *args, **kwargs):
        partial = kwargs.pop('partial', False)
        instance = self.get_object()
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)
        try:
            # If ATOMIC_REQUESTS is enabled later, keep this in an inner atomic savepoint.
            self.perform_update(serializer)
        except IntegrityError:
            return _property_integrity_response(
                serializer.validated_data.get('address_normalized'),
                user=request.user,
            )

        if getattr(instance, '_prefetched_objects_cache', None):
            instance._prefetched_objects_cache = {}
        return Response(serializer.data)

    @action(detail=False, methods=['post'], url_path='deduplicate')
    def deduplicate(self, request):
        address_normalized = normalize_address(
            request.data.get('address'),
            request.data.get('city'),
            request.data.get('state'),
            request.data.get('zip'),
        )
        property_obj = self.get_queryset().filter(address_normalized=address_normalized).first()
        if not property_obj:
            return Response({'address_normalized': address_normalized, 'exists': False, 'property': None, 'deals': []})

        deals = [
            {
                'id': str(deal_property.deal_id),
                'name': deal_property.deal.name,
                'pipeline_status': deal_property.deal.pipeline_status,
                'source_channel': deal_property.deal.source_channel,
                'source_date': deal_property.deal.source_date,
            }
            for deal_property in property_obj.deal_properties.select_related('deal')
            if _can_access_deal(self.request.user, deal_property.deal)
        ]
        return Response({
            'address_normalized': address_normalized,
            'exists': True,
            'property': PropertySerializer(property_obj).data,
            'deals': deals,
        })


class DealViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = DealSerializer
    queryset = Deal.objects.select_related('sponsor', 'broker', 'assigned_analyst', 'fund').prefetch_related(
        'deal_properties__property',
    )

    def get_serializer_class(self):
        if self.action == 'create':
            return DealCreateSerializer
        return DealSerializer

    def get_queryset(self):
        queryset = super().get_queryset()
        if not _is_staff_user(self.request.user):
            queryset = queryset.filter(assigned_analyst=self.request.user)
        for field in ['pipeline_status', 'syndication_status', 'investment_type', 'source_channel']:
            value = self.request.query_params.get(field)
            if value:
                queryset = queryset.filter(**{field: value})
        for field in ['sponsor', 'broker', 'fund']:
            value = self.request.query_params.get(field)
            if value:
                queryset = queryset.filter(**{field: _uuid_filter_value(value, field)})
        assigned_analyst = self.request.query_params.get('assigned_analyst')
        if _is_staff_user(self.request.user):
            if assigned_analyst == 'me' and getattr(self.request.user, 'is_authenticated', False):
                queryset = queryset.filter(assigned_analyst=self.request.user)
            elif assigned_analyst:
                queryset = queryset.filter(assigned_analyst=_int_filter_value(assigned_analyst, 'assigned_analyst'))
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(name__icontains=search)
        return queryset

    def perform_create(self, serializer):
        serializer.save(assigned_analyst=self.request.user)

    def perform_update(self, serializer):
        serializer.context['audit_ip_address'] = _client_ip(self.request)
        serializer.save()

    @action(detail=True, methods=['post'], url_path='transition')
    def transition(self, request, pk=None):
        deal = self.get_object()
        serializer = PipelineTransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            deal = transition_pipeline_status(
                deal,
                serializer.validated_data['to_status'],
                request.user,
                serializer.validated_data['reason'],
                ip_address=_client_ip(request),
            )
        except DjangoValidationError as exc:
            return _django_validation_response(exc)
        return Response(self.get_serializer(deal).data)

    @action(detail=True, methods=['post'], url_path='transition-syndication')
    def transition_syndication(self, request, pk=None):
        deal = self.get_object()
        serializer = SyndicationTransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            deal = transition_syndication_status(
                deal,
                serializer.validated_data['to_status'],
                request.user,
                serializer.validated_data['reason'],
                ip_address=_client_ip(request),
            )
        except DjangoValidationError as exc:
            return _django_validation_response(exc)
        return Response(self.get_serializer(deal).data)

    @action(detail=True, methods=['get'], url_path='allowed-transitions')
    def allowed_transitions(self, request, pk=None):
        deal = self.get_object()
        return Response({
            'pipeline_status': allowed_pipeline_statuses(deal),
            'syndication_status': allowed_syndication_statuses(deal),
        })

    @action(detail=True, methods=['get'], url_path='stage-history')
    def stage_history(self, request, pk=None):
        deal = self.get_object()
        events = deal.stage_events.select_related('performed_by').order_by('-entered_at', '-id')
        page = self.paginate_queryset(events)
        if page is not None:
            return self.get_paginated_response(DealStageEventSerializer(page, many=True).data)
        return Response(DealStageEventSerializer(events, many=True).data)

    @action(detail=False, methods=['get'], url_path='summary')
    def summary(self, request):
        queryset = self.filter_queryset(self.get_queryset())
        active_queryset = queryset.exclude(pipeline_status__in=[PipelineStatus.DEAD, PipelineStatus.EXITED])
        status_counts = list(
            queryset.values('pipeline_status')
            .annotate(count=Count('id'), requested_amount=Sum('requested_amount'))
            .order_by('pipeline_status')
        )
        active_requested = active_queryset.aggregate(total=Sum('requested_amount'))['total']
        gross_requested = queryset.aggregate(total=Sum('requested_amount'))['total']
        active_count = active_queryset.count()
        timing_metrics = _stage_timing_metrics(queryset, status_counts)
        return Response({
            'active_deals': active_count,
            'pipeline_value': active_requested or 0,
            'gross_pipeline_value': gross_requested or 0,
            'by_pipeline_status': status_counts,
            **timing_metrics,
        })

    def destroy(self, request, *args, **kwargs):
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response(
                {'detail': 'Deal cannot be deleted while protected related records exist.'},
                status=status.HTTP_400_BAD_REQUEST,
            )


class DealPropertyViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = DealPropertySerializer
    queryset = DealProperty.objects.select_related('deal', 'property')

    def get_queryset(self):
        queryset = super().get_queryset()
        if not _is_staff_user(self.request.user):
            queryset = queryset.filter(deal__assigned_analyst=self.request.user)
        deal_id = self.request.query_params.get('deal')
        if deal_id:
            queryset = queryset.filter(deal=_uuid_filter_value(deal_id, 'deal'))
        property_id = self.request.query_params.get('property')
        if property_id:
            queryset = queryset.filter(property=_uuid_filter_value(property_id, 'property'))
        return queryset

    def perform_create(self, serializer):
        deal = serializer.validated_data['deal']
        if not _can_access_deal(self.request.user, deal):
            raise PermissionDenied('You cannot attach properties to this deal.')
        is_primary = serializer.validated_data.get('is_primary', False)
        if not is_primary and not DealProperty.objects.filter(deal=deal).exists():
            serializer.save(is_primary=True)
            return
        serializer.save()

    def perform_destroy(self, instance):
        if instance.is_primary:
            replacement = (
                DealProperty.objects
                .filter(deal=instance.deal)
                .exclude(pk=instance.pk)
                .order_by('property__address_normalized')
                .first()
            )
            with transaction.atomic():
                instance.delete()
                if replacement:
                    replacement.is_primary = True
                    replacement.save(update_fields=['is_primary'])
            return
        instance.delete()


class DocumentViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = DocumentSerializer
    queryset = Document.objects.select_related('deal', 'uploaded_by')

    def get_queryset(self):
        queryset = super().get_queryset()
        if not _is_staff_user(self.request.user):
            queryset = queryset.filter(deal__assigned_analyst=self.request.user)
            queryset = _filter_visibility_role(queryset, 'internal')
        storage_status = self.request.query_params.get('storage_status')
        if storage_status:
            if not _is_staff_user(self.request.user):
                raise PermissionDenied('Only staff may filter by storage_status.')
            queryset = queryset.filter(storage_status=storage_status)
        elif self.action == 'list':
            queryset = queryset.filter(storage_status=DocumentStorageStatus.READY)
        deal_id = self.request.query_params.get('deal')
        if deal_id:
            queryset = queryset.filter(deal=_uuid_filter_value(deal_id, 'deal'))
        category = self.request.query_params.get('category')
        if category:
            queryset = queryset.filter(category=category)
        visibility_role = self.request.query_params.get('visibility_role')
        if visibility_role:
            if not _is_staff_user(self.request.user) and visibility_role != 'internal':
                return queryset.none()
            queryset = _filter_visibility_role(queryset, visibility_role)
        return queryset

    def create(self, request, *args, **kwargs):
        # Documents are created only through the upload-intent flow, which
        # generates the storage key server-side. Direct POST is not supported.
        return Response(
            {'detail': 'Direct document creation is disabled. Use upload-intent.'},
            status=status.HTTP_403_FORBIDDEN,
        )

    def perform_destroy(self, instance):
        if instance.is_executed and not _is_staff_user(self.request.user):
            raise PermissionDenied('Only staff may delete executed documents.')
        storage_key = instance.file_url
        storage = get_document_storage()
        if storage_key:
            storage.delete_object(storage_key)
        with transaction.atomic():
            instance.delete()

    @action(detail=False, methods=['post'], url_path='upload-intent')
    def upload_intent(self, request):
        serializer = DocumentUploadIntentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        deal = data['deal']
        # Match DealViewSet: inaccessible deals are indistinguishable from missing.
        if not _can_access_deal(request.user, deal):
            raise NotFound()

        uploaded_by = request.user if getattr(request.user, 'is_authenticated', False) else None
        visibility_roles = data.get('visibility_roles') or ['internal']
        if not _is_staff_user(request.user) and 'internal' not in visibility_roles:
            visibility_roles = [*visibility_roles, 'internal']

        # Lock the deal row so concurrent uploads allocate distinct versions; the
        # unique_document_version constraint is the database backstop.
        with transaction.atomic():
            Deal.objects.select_for_update().filter(pk=deal.pk).first()
            next_version = _next_document_version(deal, data['category'], data['document_name'])
            document_id = uuid.uuid4()
            storage_key = build_document_key(deal.pk, document_id, next_version, data['document_name'])
            document = Document.objects.create(
                pk=document_id,
                deal=deal,
                document_name=data['document_name'],
                category=data['category'],
                subcategory=data.get('subcategory', ''),
                version=next_version,
                file_url=storage_key,
                file_type=data['file_type'],
                content_type=data['content_type'],
                file_size_bytes=data['file_size_bytes'],
                checksum_sha256=data.get('checksum_sha256', ''),
                storage_status=DocumentStorageStatus.PENDING,
                pipeline_stage_at_upload=deal.pipeline_status,
                uploaded_by=uploaded_by,
                notes=data.get('notes', ''),
                expiry_date=data.get('expiry_date'),
                visibility_roles=visibility_roles,
            )
        return self._upload_intent_response(request, document)

    def _upload_intent_response(self, request, document):
        upload_target = _build_upload_target(request, document)
        return Response(
            {
                'document': DocumentSerializer(document).data,
                'upload_url': upload_target.url,
                'upload_method': upload_target.method,
                'upload_headers': upload_target.headers,
                'expires_in': upload_target.expires_in,
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['post'], url_path='complete')
    def complete(self, request, pk=None):
        document = self.get_object()
        if document.storage_status != DocumentStorageStatus.PENDING:
            return Response({'detail': 'Document upload is not pending.'}, status=status.HTTP_409_CONFLICT)
        if not _can_access_deal(request.user, document.deal):
            raise PermissionDenied('You cannot complete uploads for this deal.')

        serializer = DocumentUploadCompleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        declared_checksum = serializer.validated_data.get('checksum_sha256') or document.checksum_sha256

        # Verify the object exists and its size matches. We do not re-download the
        # object from R2 to hash it — for local storage the SHA-256 was already
        # computed from the received bytes during the blob PUT.
        storage = get_document_storage()
        meta = storage.head_object(document.file_url)
        if meta is None:
            return Response({'detail': 'Uploaded file was not found in storage.'}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)
        if document.file_size_bytes is not None and meta.size != document.file_size_bytes:
            return Response(
                {'detail': f'Uploaded size {meta.size} does not match expected {document.file_size_bytes}.'},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        if (
            declared_checksum
            and document.checksum_sha256
            and document.checksum_sha256.lower() != declared_checksum.lower()
        ):
            return Response({'detail': 'Checksum verification failed.'}, status=status.HTTP_422_UNPROCESSABLE_ENTITY)

        with transaction.atomic():
            document.storage_status = DocumentStorageStatus.READY
            if declared_checksum and not document.checksum_sha256:
                document.checksum_sha256 = declared_checksum
            document.save(update_fields=['storage_status', 'checksum_sha256'])
            _log_document_upload(request, document)

        return Response(DocumentSerializer(document).data)

    @action(detail=True, methods=['get'], url_path='download')
    def download(self, request, pk=None):
        document = self.get_object()
        if document.storage_status != DocumentStorageStatus.READY:
            return Response({'detail': 'Document is not ready for download.'}, status=status.HTTP_409_CONFLICT)
        if not _can_access_deal(request.user, document.deal):
            raise PermissionDenied('You cannot download documents for this deal.')

        download_target = _build_download_target(request, document)
        payload = {
            'download_url': download_target.url,
            'expires_in': download_target.expires_in,
            'document_name': document.document_name,
            'filename': _download_filename(document),
            'content_type': document.content_type or 'application/octet-stream',
            'file_size_bytes': document.file_size_bytes,
        }
        return Response(DocumentDownloadSerializer(payload).data)

    @action(detail=True, methods=['put', 'get'], url_path='blob')
    def blob(self, request, pk=None):
        if getattr(settings, 'DOCUMENT_STORAGE_BACKEND', 'local') != 'local':
            return Response({'detail': 'Direct blob access is only available for local storage.'}, status=status.HTTP_404_NOT_FOUND)

        document = Document.objects.select_related('deal').filter(pk=pk).first()
        if document is None:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)
        # Match DealViewSet: do not confirm deal/document existence to outsiders.
        if not _can_access_deal(request.user, document.deal):
            raise NotFound()

        storage = get_document_storage()
        if request.method == 'PUT':
            if document.storage_status != DocumentStorageStatus.PENDING:
                return Response({'detail': 'Document upload is not pending.'}, status=status.HTTP_409_CONFLICT)
            body = request.body
            if len(body) > max_upload_bytes():
                return Response({'detail': 'File exceeds maximum upload size.'}, status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE)
            if document.file_size_bytes is not None and len(body) != document.file_size_bytes:
                return Response(
                    {'detail': f'Uploaded size {len(body)} does not match expected {document.file_size_bytes}.'},
                    status=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )
            request_content_type = (request.headers.get('Content-Type') or '').split(';', 1)[0].strip().lower()
            declared_content_type = (document.content_type or '').split(';', 1)[0].strip().lower()
            if declared_content_type and request_content_type and request_content_type != declared_content_type:
                return Response(
                    {'detail': f'Content-Type {request_content_type} does not match expected {declared_content_type}.'},
                    status=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )
            # If a checksum was declared at upload-intent, verify the received
            # bytes against it before storing anything; otherwise record the
            # computed digest so `complete` and downloads have it on file.
            computed_checksum = sha256_hex(body)
            if document.checksum_sha256 and computed_checksum.lower() != document.checksum_sha256.lower():
                return Response(
                    {'detail': 'Checksum verification failed.'},
                    status=status.HTTP_422_UNPROCESSABLE_ENTITY,
                )
            content_type = request_content_type or declared_content_type or 'application/octet-stream'
            storage.write_object(document.file_url, body, content_type)
            document.checksum_sha256 = computed_checksum
            document.save(update_fields=['checksum_sha256'])
            return Response({'detail': 'Upload received.'}, status=status.HTTP_200_OK)

        if document.storage_status != DocumentStorageStatus.READY:
            return Response({'detail': 'Document is not ready for download.'}, status=status.HTTP_409_CONFLICT)
        if not _is_staff_user(request.user):
            visible = _filter_visibility_role(Document.objects.filter(pk=document.pk), 'internal')
            if not visible.exists():
                raise PermissionDenied('You cannot download this document.')
        try:
            body, meta = storage.read_object(document.file_url)
        except FileNotFoundError:
            return Response({'detail': 'Stored file was not found.'}, status=status.HTTP_404_NOT_FOUND)
        response = HttpResponse(body, content_type=document.content_type or meta.content_type)
        response['Content-Disposition'] = f'attachment; filename="{_download_filename(document)}"'
        return response


class DealNoteViewSet(viewsets.ModelViewSet):
    # Notes are a staff-only collaboration surface, matching ActivityLogViewSet.
    # (When notes later open to assigned analysts, swap in a _can_access_deal
    # queryset scope and an author-or-staff edit/delete guard.)
    permission_classes = [IsAdminUser]
    serializer_class = DealNoteSerializer
    queryset = DealNote.objects.select_related('deal', 'author').prefetch_related('attachments')

    def get_queryset(self):
        queryset = super().get_queryset()
        deal_id = self.request.query_params.get('deal')
        if deal_id:
            queryset = queryset.filter(deal=_uuid_filter_value(deal_id, 'deal'))
        return queryset

    def perform_create(self, serializer):
        data = serializer.validated_data
        note = create_note(
            deal=data['deal'],
            author=self.request.user,
            body=data['body'],
            attachments=data.get('attachments') or [],
            ip_address=_client_ip(self.request),
        )
        serializer.instance = note


class ActivityLogViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsAdminUser]
    serializer_class = ActivityLogSerializer
    queryset = ActivityLog.objects.select_related('deal', 'performed_by')

    def get_queryset(self):
        queryset = super().get_queryset()
        deal_id = self.request.query_params.get('deal')
        if deal_id:
            queryset = queryset.filter(deal=_uuid_filter_value(deal_id, 'deal'))
        action_type = self.request.query_params.get('action_type')
        if action_type:
            queryset = queryset.filter(action_type=action_type)
        subject_model = self.request.query_params.get('subject_model')
        subject_id = self.request.query_params.get('subject_id')
        if connection.vendor == 'postgresql':
            metadata_filter = {}
            if subject_model:
                metadata_filter['subject_model'] = subject_model
            if subject_id:
                metadata_filter['subject_id'] = subject_id
            if metadata_filter:
                queryset = queryset.filter(metadata__contains=metadata_filter)
        else:
            if subject_model:
                queryset = queryset.filter(metadata__subject_model=subject_model)
            if subject_id:
                queryset = queryset.filter(metadata__subject_id=subject_id)
        return queryset


def _client_ip(request):
    forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    trusted_proxy_count = getattr(settings, 'FORWARDED_FOR_TRUSTED_PROXY_COUNT', 0)
    if forwarded_for and trusted_proxy_count > 0:
        chain = [part.strip() for part in forwarded_for.split(',') if part.strip()]
        if len(chain) >= trusted_proxy_count:
            candidate = chain[-trusted_proxy_count]
            if _valid_ip(candidate):
                return candidate
    remote_addr = request.META.get('REMOTE_ADDR')
    if remote_addr and _valid_ip(remote_addr):
        return remote_addr
    return None


def _stage_timing_metrics(queryset, status_counts):
    """Small, portable timing metrics without database-specific duration SQL."""
    now = timezone.now()
    current_totals = {}
    total_current_days = 0
    current_count = 0
    for pipeline_status, entered_at in queryset.values_list('pipeline_status', 'current_stage_entered_at'):
        days = max(0, (now - entered_at).days) if entered_at else 0
        total, count = current_totals.get(pipeline_status, (0, 0))
        current_totals[pipeline_status] = (total + days, count + 1)
        total_current_days += days
        current_count += 1

    for row in status_counts:
        total, count = current_totals.get(row['pipeline_status'], (0, 0))
        row['average_days_in_current_stage'] = round(total / count, 2) if count else 0

    completed_totals = {}
    stage_events = DealStageEvent.objects.filter(
        deal_id__in=queryset.values('pk'),
        exited_at__isnull=False,
    ).values_list('to_status', 'entered_at', 'exited_at')
    for pipeline_status, entered_at, exited_at in stage_events:
        days = max(0, (exited_at - entered_at).total_seconds() / 86400)
        total, count = completed_totals.get(pipeline_status, (0, 0))
        completed_totals[pipeline_status] = (total + days, count + 1)

    return {
        'average_days_in_current_stage': round(total_current_days / current_count, 2) if current_count else 0,
        'average_stage_duration_days': [
            {
                'pipeline_status': pipeline_status,
                'average_days': round(total / count, 2),
                'completed_events': count,
            }
            for pipeline_status, (total, count) in sorted(completed_totals.items())
        ],
    }


def _valid_ip(value):
    try:
        ip_address(value)
    except ValueError:
        return False
    return True


def _uuid_filter_value(value, field_name):
    try:
        return UUID(str(value))
    except (TypeError, ValueError) as exc:
        raise DRFValidationError({field_name: 'Invalid UUID.'}) from exc


def _int_filter_value(value, field_name):
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise DRFValidationError({field_name: 'Invalid integer.'}) from exc


def _is_staff_user(user):
    return bool(getattr(user, 'is_staff', False) or getattr(user, 'is_superuser', False))


def _can_access_deal(user, deal):
    if not getattr(user, 'is_authenticated', False):
        return False
    return _is_staff_user(user) or deal.assigned_analyst_id == user.id


def _filter_visibility_role(queryset, visibility_role):
    if connection.vendor == 'postgresql':
        return queryset.filter(visibility_roles__contains=[visibility_role])
    matching_ids = [document.pk for document in queryset if visibility_role in (document.visibility_roles or [])]
    return queryset.filter(pk__in=matching_ids)


def _next_document_version(deal, category, document_name):
    return (
        Document.objects.filter(
            deal=deal,
            category=category,
            document_name=document_name,
        ).aggregate(max_version=Max('version'))['max_version'] or 0
    ) + 1


def _log_document_upload(request, document):
    performed_by = request.user if getattr(request.user, 'is_authenticated', False) else document.uploaded_by
    ActivityLog.objects.create(
        deal=document.deal,
        action_type=ActivityActionType.DOCUMENT_UPLOAD,
        performed_by=performed_by,
        ip_address=_client_ip(request),
        description=f'Document uploaded: {document.document_name} v{document.version}',
        metadata={
            'document_id': str(document.pk),
            'category': document.category,
            'file_size_bytes': document.file_size_bytes,
            'storage_key': document.file_url,
        },
    )


def _build_upload_target(request, document) -> PresignedUpload:
    content_type = document.content_type or 'application/octet-stream'
    if getattr(settings, 'DOCUMENT_STORAGE_BACKEND', 'local') == 'local':
        return PresignedUpload(
            url=request.build_absolute_uri(f'/api/documents/{document.pk}/blob/'),
            method='PUT',
            headers={'Content-Type': content_type},
            expires_in=0,
        )
    return get_document_storage().presign_upload(document.file_url, content_type)


def _download_filename(document) -> str:
    """Filename for Content-Disposition, appending the file extension only when
    the document name does not already carry it (avoids `report.pdf.pdf`)."""
    name = sanitize_filename(document.document_name)
    ext = (document.file_type or '').lower().lstrip('.')
    if ext and not name.lower().endswith(f'.{ext}'):
        name = f'{name}.{ext}'
    return name


def _build_download_target(request, document) -> PresignedDownload:
    content_type = document.content_type or 'application/octet-stream'
    if getattr(settings, 'DOCUMENT_STORAGE_BACKEND', 'local') == 'local':
        return PresignedDownload(
            url=request.build_absolute_uri(f'/api/documents/{document.pk}/blob/'),
            expires_in=0,
        )
    return get_document_storage().presign_download(document.file_url, _download_filename(document), content_type)


def _django_validation_response(exc):
    if hasattr(exc, 'message_dict'):
        return Response(exc.message_dict, status=status.HTTP_400_BAD_REQUEST)
    return Response({'detail': exc.messages}, status=status.HTTP_400_BAD_REQUEST)


def _property_integrity_response(address_normalized, user=None):
    existing_property = None
    if address_normalized:
        existing_property = Property.objects.filter(address_normalized=address_normalized).first()
    body = {'address_normalized': 'A property with this normalized address already exists.'}
    # Only reveal the UUID when the caller could already attach that property.
    if existing_property and (user is None or _can_attach_property(user, existing_property)):
        body['existing_property'] = str(existing_property.pk)
    return Response(body, status=status.HTTP_400_BAD_REQUEST)
