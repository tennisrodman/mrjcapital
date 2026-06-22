from ipaddress import ip_address
from uuid import UUID

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import connection, IntegrityError, transaction
from django.db.models import Count, Max, Sum
from django.db.models.deletion import ProtectedError
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError as DRFValidationError
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.response import Response

from api.models import (
    ActivityActionType,
    ActivityLog,
    Broker,
    Deal,
    DealProperty,
    Document,
    Fund,
    PipelineStatus,
    Property,
    Sponsor,
)
from api.serializers import (
    ActivityLogSerializer,
    BrokerSerializer,
    DealPropertySerializer,
    DealSerializer,
    DocumentSerializer,
    FundSerializer,
    PipelineTransitionSerializer,
    PropertySerializer,
    SensitiveFieldReadSerializer,
    SponsorSerializer,
    SyndicationTransitionSerializer,
)
from api.services import (
    allowed_pipeline_statuses,
    allowed_syndication_statuses,
    log_sensitive_field_read,
    normalize_address,
    transition_pipeline_status,
    transition_syndication_status,
)


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
            return _property_integrity_response(serializer.validated_data.get('address_normalized'))
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
            return _property_integrity_response(serializer.validated_data.get('address_normalized'))

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

    @action(detail=False, methods=['get'], url_path='summary')
    def summary(self, request):
        queryset = self.filter_queryset(self.get_queryset())
        active_queryset = queryset.exclude(pipeline_status__in=[PipelineStatus.DEAD, PipelineStatus.EXITED])
        status_counts = queryset.values('pipeline_status').annotate(count=Count('id')).order_by('pipeline_status')
        active_requested = active_queryset.aggregate(total=Sum('requested_amount'))['total']
        gross_requested = queryset.aggregate(total=Sum('requested_amount'))['total']
        active_count = active_queryset.count()
        return Response({
            'active_deals': active_count,
            'pipeline_value': active_requested or 0,
            'gross_pipeline_value': gross_requested or 0,
            'by_pipeline_status': list(status_counts),
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

    def perform_create(self, serializer):
        uploaded_by = self.request.user if getattr(self.request.user, 'is_authenticated', False) else None
        deal = serializer.validated_data['deal']
        if not _can_access_deal(self.request.user, deal):
            raise PermissionDenied('You cannot add documents to this deal.')
        with transaction.atomic():
            next_version = (
                Document.objects
                .filter(
                    deal=deal,
                    category=serializer.validated_data['category'],
                    document_name=serializer.validated_data['document_name'],
                )
                .aggregate(max_version=Max('version'))['max_version'] or 0
            ) + 1
            document = serializer.save(uploaded_by=uploaded_by, version=next_version)
            ActivityLog.objects.create(
                deal=document.deal,
                action_type=ActivityActionType.DOCUMENT_UPLOAD,
                performed_by=uploaded_by,
                ip_address=_client_ip(self.request),
                description=f'Document uploaded: {document.document_name}',
                metadata={'document_id': str(document.pk), 'category': document.category},
            )


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


def _django_validation_response(exc):
    if hasattr(exc, 'message_dict'):
        return Response(exc.message_dict, status=status.HTTP_400_BAD_REQUEST)
    return Response({'detail': exc.messages}, status=status.HTTP_400_BAD_REQUEST)


def _property_integrity_response(address_normalized):
    existing_property = None
    if address_normalized:
        existing_property = Property.objects.filter(address_normalized=address_normalized).first()
    body = {'address_normalized': 'A property with this normalized address already exists.'}
    if existing_property:
        body['existing_property'] = str(existing_property.pk)
    return Response(body, status=status.HTTP_400_BAD_REQUEST)
