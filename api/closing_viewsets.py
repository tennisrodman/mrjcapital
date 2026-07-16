from uuid import UUID

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import mixins, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError as DRFValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from api.closing_serializers import (
    ClosingAssigneeSerializer,
    ClosingChecklistGenerationSerializer,
    ClosingDocumentsSerializer,
    ClosingGenerateSerializer,
    ClosingItemCreateSerializer,
    ClosingItemUpdateSerializer,
    ClosingPackageSerializer,
    ClosingPackageWriteSerializer,
    ConditionPrecedentSerializer,
    DDChecklistItemSerializer,
    DDTemplateSerializer,
)
from api.models import (
    ClosingChecklistGeneration,
    ClosingPackage,
    ConditionPrecedent,
    DDChecklistItem,
    DDTemplate,
)
from api.models.deal import Deal
from api.policies import can_access_deal as _can_access_deal, is_staff_user as _is_staff_user
from api.services.closing import (
    closing_assignees,
    create_cp_item,
    create_dd_item,
    delete_cp_item,
    delete_dd_item,
    generate_closing_checklist,
    set_cp_documents,
    set_dd_documents,
    update_cp_item,
    update_dd_item,
    upsert_closing_package,
)


User = get_user_model()


def _uuid_filter_value(value, field_name):
    try:
        return UUID(str(value))
    except (TypeError, ValueError) as exc:
        raise DRFValidationError({field_name: 'Enter a valid UUID.'}) from exc


def _django_validation_response(exc):
    if hasattr(exc, 'message_dict'):
        return Response(exc.message_dict, status=status.HTTP_400_BAD_REQUEST)
    return Response({'detail': list(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)


def _resolve_accessible_deal(user, deal_id):
    deal = Deal.objects.filter(pk=_uuid_filter_value(deal_id, 'deal')).first()
    if not deal or not _can_access_deal(user, deal):
        raise NotFound()
    return deal


def _resolve_owner(owner_id):
    if owner_id in (None, ''):
        return None
    owner = User.objects.filter(pk=owner_id).first()
    if owner is None:
        raise DRFValidationError({'owner': 'Selected owner is not available for this deal.'})
    return owner


class DDTemplateViewSet(viewsets.ReadOnlyModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = DDTemplateSerializer
    queryset = DDTemplate.objects.filter(is_active=True).prefetch_related('items')
    http_method_names = ['get', 'head', 'options']


class ClosingPackageViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = ClosingPackageSerializer
    queryset = ClosingPackage.objects.select_related('deal')
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_queryset(self):
        queryset = super().get_queryset()
        if not _is_staff_user(self.request.user):
            queryset = queryset.filter(deal__assigned_analyst=self.request.user)
        deal_id = self.request.query_params.get('deal')
        if deal_id:
            queryset = queryset.filter(deal=_uuid_filter_value(deal_id, 'deal'))
        return queryset

    def retrieve(self, request, *args, **kwargs):
        try:
            return super().retrieve(request, *args, **kwargs)
        except ClosingPackage.DoesNotExist as exc:
            raise NotFound() from exc

    def create(self, request, *args, **kwargs):
        serializer = ClosingPackageWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        deal_id = serializer.validated_data.get('deal') or request.data.get('deal')
        if not deal_id:
            raise DRFValidationError({'deal': 'This field is required.'})
        deal = _resolve_accessible_deal(request.user, deal_id)
        fields_present = set(serializer.validated_data.keys()) - {'deal'}
        package_fields = {
            field: value
            for field, value in serializer.validated_data.items()
            if field != 'deal'
        }
        try:
            package, created = upsert_closing_package(
                deal,
                performed_by=request.user,
                fields_present=fields_present,
                **package_fields,
            )
        except DjangoValidationError as exc:
            return _django_validation_response(exc)
        out = ClosingPackageSerializer(package, context=self.get_serializer_context())
        return Response(out.data, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    def partial_update(self, request, *args, **kwargs):
        package = self.get_object()
        if not _can_access_deal(request.user, package.deal):
            raise NotFound()
        serializer = ClosingPackageWriteSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        fields_present = set(serializer.validated_data.keys()) - {'deal'}
        package_fields = {
            field: value
            for field, value in serializer.validated_data.items()
            if field != 'deal'
        }
        try:
            package, _ = upsert_closing_package(
                package.deal,
                performed_by=request.user,
                fields_present=fields_present,
                **package_fields,
            )
        except DjangoValidationError as exc:
            return _django_validation_response(exc)
        return Response(ClosingPackageSerializer(package, context=self.get_serializer_context()).data)

    @action(detail=False, methods=['post'], url_path='generate')
    def generate(self, request):
        serializer = ClosingGenerateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        deal = _resolve_accessible_deal(request.user, serializer.validated_data['deal'])
        template = DDTemplate.objects.filter(
            pk=serializer.validated_data['template_id'],
            is_active=True,
        ).first()
        if not template:
            raise DRFValidationError({'template_id': 'Selected template is not available.'})
        try:
            generation = generate_closing_checklist(
                deal,
                template,
                performed_by=request.user,
                force=serializer.validated_data.get('force', False),
                force_reason=serializer.validated_data.get('force_reason', ''),
                initial_target_close_date=serializer.validated_data.get('target_close_date'),
            )
        except DjangoValidationError as exc:
            return _django_validation_response(exc)
        return Response(
            ClosingChecklistGenerationSerializer(generation, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=['get'], url_path='assignees')
    def assignees(self, request, pk=None):
        package = self.get_object()
        if not _can_access_deal(request.user, package.deal):
            raise NotFound()
        users = closing_assignees(package.deal)
        return Response(ClosingAssigneeSerializer(users, many=True).data)


class ClosingChecklistGenerationViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = ClosingChecklistGenerationSerializer
    queryset = ClosingChecklistGeneration.objects.select_related(
        'package', 'package__deal', 'generated_by', 'superseded_by', 'template',
    )

    def get_queryset(self):
        queryset = super().get_queryset()
        if not _is_staff_user(self.request.user):
            queryset = queryset.filter(package__deal__assigned_analyst=self.request.user)
        deal_id = self.request.query_params.get('deal')
        if deal_id:
            queryset = queryset.filter(package__deal=_uuid_filter_value(deal_id, 'deal'))
        current = self.request.query_params.get('current')
        if current in ('1', 'true', 'True'):
            queryset = queryset.filter(is_current=True)
        return queryset


class DDChecklistItemViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = DDChecklistItemSerializer
    queryset = DDChecklistItem.objects.select_related(
        'generation', 'generation__package', 'generation__package__deal', 'owner', 'created_by',
    ).prefetch_related('documents')
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    def get_queryset(self):
        queryset = super().get_queryset()
        if not _is_staff_user(self.request.user):
            queryset = queryset.filter(generation__package__deal__assigned_analyst=self.request.user)
        deal_id = self.request.query_params.get('deal')
        if deal_id:
            queryset = queryset.filter(
                generation__package__deal=_uuid_filter_value(deal_id, 'deal'),
            )
        current = self.request.query_params.get('current')
        if current in ('1', 'true', 'True'):
            queryset = queryset.filter(generation__is_current=True)
        return queryset

    def create(self, request, *args, **kwargs):
        serializer = ClosingItemCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        deal = _resolve_accessible_deal(request.user, serializer.validated_data['deal'])
        owner = None
        if 'owner' in serializer.validated_data:
            owner = _resolve_owner(serializer.validated_data.get('owner'))
        try:
            item = create_dd_item(
                deal,
                title=serializer.validated_data['title'],
                description=serializer.validated_data.get('description') or '',
                owner=owner,
                due_date=serializer.validated_data.get('due_date'),
                performed_by=request.user,
            )
        except DjangoValidationError as exc:
            return _django_validation_response(exc)
        return Response(
            DDChecklistItemSerializer(item, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

    def partial_update(self, request, *args, **kwargs):
        item = self.get_object()
        serializer = ClosingItemUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        payload = dict(serializer.validated_data)
        if 'owner' in payload:
            payload['owner'] = _resolve_owner(payload.get('owner'))
        try:
            item = update_dd_item(item, performed_by=request.user, **payload)
        except DjangoValidationError as exc:
            return _django_validation_response(exc)
        return Response(DDChecklistItemSerializer(item, context=self.get_serializer_context()).data)

    def destroy(self, request, *args, **kwargs):
        item = self.get_object()
        try:
            delete_dd_item(item, performed_by=request.user)
        except DjangoValidationError as exc:
            return _django_validation_response(exc)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='documents')
    def documents(self, request, pk=None):
        item = self.get_object()
        serializer = ClosingDocumentsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            item = set_dd_documents(
                item,
                serializer.validated_data['document_ids'],
                performed_by=request.user,
                user=request.user,
            )
        except DjangoValidationError as exc:
            return _django_validation_response(exc)
        return Response(DDChecklistItemSerializer(item, context=self.get_serializer_context()).data)


class ConditionPrecedentViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = ConditionPrecedentSerializer
    queryset = ConditionPrecedent.objects.select_related(
        'generation', 'generation__package', 'generation__package__deal', 'owner', 'created_by',
    ).prefetch_related('documents')
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    def get_queryset(self):
        queryset = super().get_queryset()
        if not _is_staff_user(self.request.user):
            queryset = queryset.filter(generation__package__deal__assigned_analyst=self.request.user)
        deal_id = self.request.query_params.get('deal')
        if deal_id:
            queryset = queryset.filter(
                generation__package__deal=_uuid_filter_value(deal_id, 'deal'),
            )
        current = self.request.query_params.get('current')
        if current in ('1', 'true', 'True'):
            queryset = queryset.filter(generation__is_current=True)
        return queryset

    def create(self, request, *args, **kwargs):
        serializer = ClosingItemCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        deal = _resolve_accessible_deal(request.user, serializer.validated_data['deal'])
        owner = None
        if 'owner' in serializer.validated_data:
            owner = _resolve_owner(serializer.validated_data.get('owner'))
        try:
            item = create_cp_item(
                deal,
                title=serializer.validated_data['title'],
                description=serializer.validated_data.get('description') or '',
                owner=owner,
                due_date=serializer.validated_data.get('due_date'),
                performed_by=request.user,
            )
        except DjangoValidationError as exc:
            return _django_validation_response(exc)
        return Response(
            ConditionPrecedentSerializer(item, context=self.get_serializer_context()).data,
            status=status.HTTP_201_CREATED,
        )

    def partial_update(self, request, *args, **kwargs):
        item = self.get_object()
        serializer = ClosingItemUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        payload = dict(serializer.validated_data)
        if 'owner' in payload:
            payload['owner'] = _resolve_owner(payload.get('owner'))
        try:
            item = update_cp_item(item, performed_by=request.user, **payload)
        except DjangoValidationError as exc:
            return _django_validation_response(exc)
        return Response(ConditionPrecedentSerializer(item, context=self.get_serializer_context()).data)

    def destroy(self, request, *args, **kwargs):
        item = self.get_object()
        try:
            delete_cp_item(item, performed_by=request.user)
        except DjangoValidationError as exc:
            return _django_validation_response(exc)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=['post'], url_path='documents')
    def documents(self, request, pk=None):
        item = self.get_object()
        serializer = ClosingDocumentsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            item = set_cp_documents(
                item,
                serializer.validated_data['document_ids'],
                performed_by=request.user,
                user=request.user,
            )
        except DjangoValidationError as exc:
            return _django_validation_response(exc)
        return Response(ConditionPrecedentSerializer(item, context=self.get_serializer_context()).data)
