from uuid import UUID

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Exists, OuterRef
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError as DRFValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from api.models.deal import Deal
from api.models.quote import Quote
from api.quote_serializers import (
    QuoteAttachmentsSerializer,
    QuoteSendSerializer,
    QuoteSerializer,
)
from api.services.quotes import (
    counter_quote,
    execute_quote,
    expire_quote,
    send_quote,
    set_quote_attachments,
    withdraw_quote,
)


class QuoteViewSet(viewsets.ModelViewSet):
    """Deal-scoped quotes with send / counter / execute workflow actions."""

    permission_classes = [IsAuthenticated]
    serializer_class = QuoteSerializer
    queryset = Quote.objects.select_related('deal', 'created_by').prefetch_related('attachments')

    def create(self, request, *args, **kwargs):
        deal_id = request.data.get('deal')
        if deal_id:
            deal = Deal.objects.filter(pk=_uuid_filter_value(deal_id, 'deal')).first()
            if not deal or not _can_access_deal(request.user, deal):
                raise NotFound()
        return super().create(request, *args, **kwargs)

    def get_queryset(self):
        newer_version = Quote.objects.filter(
            deal_id=OuterRef('deal_id'),
            version__gt=OuterRef('version'),
        )
        queryset = super().get_queryset().annotate(is_current_annotation=~Exists(newer_version))
        if not _is_staff_user(self.request.user):
            queryset = queryset.filter(deal__assigned_analyst=self.request.user)

        deal_id = self.request.query_params.get('deal')
        if deal_id:
            queryset = queryset.filter(deal=_uuid_filter_value(deal_id, 'deal'))

        status = self.request.query_params.get('status')
        if status:
            if status not in Quote.Status.values:
                raise DRFValidationError({'status': 'Unsupported quote status.'})
            queryset = queryset.filter(status=status)

        current = self.request.query_params.get('current')
        if current is not None:
            is_current = _boolean_filter_value(current, 'current')
            queryset = queryset.filter(is_current_annotation=is_current)
        return queryset

    def perform_create(self, serializer):
        deal = serializer.validated_data['deal']
        # Match the Deal and Document APIs: an inaccessible deal is not
        # distinguishable from a missing one.
        if not _can_access_deal(self.request.user, deal):
            raise NotFound()
        serializer.save()

    def perform_destroy(self, instance):
        raise DRFValidationError({
            'status': 'Quote versions cannot be deleted; create a new version instead.',
        })

    @action(detail=True, methods=['post'], url_path='send')
    def send(self, request, pk=None):
        quote = self.get_object()
        serializer = QuoteSendSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            sent = send_quote(
                quote,
                expires_at=serializer.validated_data.get('expires_at'),
                performed_by=request.user,
            )
        except DjangoValidationError as exc:
            _raise_drf_validation(exc)
        return Response(self.get_serializer(sent).data)

    @action(detail=True, methods=['post'], url_path='counter')
    def counter(self, request, pk=None):
        quote = self.get_object()
        try:
            countered = counter_quote(quote=quote, created_by=request.user)
        except DjangoValidationError as exc:
            _raise_drf_validation(exc)
        return Response(self.get_serializer(countered).data)

    @action(detail=True, methods=['post'], url_path='execute')
    def execute(self, request, pk=None):
        quote = self.get_object()
        try:
            executed = execute_quote(quote, performed_by=request.user)
        except DjangoValidationError as exc:
            _raise_drf_validation(exc)
        return Response(self.get_serializer(executed).data)

    @action(detail=True, methods=['post'], url_path='withdraw')
    def withdraw(self, request, pk=None):
        quote = self.get_object()
        try:
            withdrawn = withdraw_quote(quote, performed_by=request.user)
        except DjangoValidationError as exc:
            _raise_drf_validation(exc)
        return Response(self.get_serializer(withdrawn).data)

    @action(detail=True, methods=['post'], url_path='expire')
    def expire(self, request, pk=None):
        quote = self.get_object()
        try:
            expired = expire_quote(quote, performed_by=request.user)
        except DjangoValidationError as exc:
            _raise_drf_validation(exc)
        return Response(self.get_serializer(expired).data)

    @action(detail=True, methods=['post'], url_path='attachments')
    def attachments(self, request, pk=None):
        quote = self.get_object()
        serializer = QuoteAttachmentsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            updated = set_quote_attachments(
                quote,
                serializer.validated_data['document_ids'],
                user=request.user,
            )
        except DjangoValidationError as exc:
            _raise_drf_validation(exc)
        return Response(self.get_serializer(updated).data)


def _is_staff_user(user):
    return bool(getattr(user, 'is_staff', False) or getattr(user, 'is_superuser', False))


def _can_access_deal(user, deal):
    if not getattr(user, 'is_authenticated', False):
        return False
    return _is_staff_user(user) or deal.assigned_analyst_id == user.id


def _uuid_filter_value(value, field_name):
    try:
        return UUID(str(value))
    except (TypeError, ValueError) as exc:
        raise DRFValidationError({field_name: 'Invalid UUID.'}) from exc


def _boolean_filter_value(value, field_name):
    normalized = str(value).lower()
    if normalized in {'1', 'true'}:
        return True
    if normalized in {'0', 'false'}:
        return False
    raise DRFValidationError({field_name: 'Expected true or false.'})


def _raise_drf_validation(exc):
    if hasattr(exc, 'message_dict'):
        raise DRFValidationError(exc.message_dict) from exc
    raise DRFValidationError({'detail': exc.messages}) from exc
