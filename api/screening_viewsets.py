from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Exists, OuterRef
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError as DRFValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from api.models.deal import Deal
from api.models.screening import ScreeningAssessment
from api.drf import (
    boolean_filter_value as _boolean_filter_value,
    raise_drf_validation as _raise_drf_validation,
    uuid_filter_value as _uuid_filter_value,
)
from api.policies import can_access_deal as _can_access_deal, is_staff_user as _is_staff_user
from api.screening_serializers import ScreeningAssessmentSerializer, ScreeningFinalizeSerializer
from api.services.screening import finalize_assessment


class ScreeningAssessmentViewSet(viewsets.ModelViewSet):
    """Deal-scoped screening assessments with a one-way finalization action."""

    permission_classes = [IsAuthenticated]
    serializer_class = ScreeningAssessmentSerializer
    queryset = ScreeningAssessment.objects.select_related('deal', 'reviewer')

    def create(self, request, *args, **kwargs):
        deal_id = request.data.get('deal')
        if deal_id:
            deal = Deal.objects.filter(pk=_uuid_filter_value(deal_id, 'deal')).first()
            if not deal or not _can_access_deal(request.user, deal):
                raise NotFound()
        return super().create(request, *args, **kwargs)

    def get_queryset(self):
        newer_version = ScreeningAssessment.objects.filter(
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
            if status not in ScreeningAssessment.Status.values:
                raise DRFValidationError({'status': 'Unsupported screening status.'})
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
            'status': 'Screening assessment versions cannot be deleted; create a new version instead.',
        })

    @action(detail=True, methods=['post'], url_path='finalize')
    def finalize(self, request, pk=None):
        assessment = self.get_object()
        serializer = ScreeningFinalizeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            finalized = finalize_assessment(
                assessment=assessment,
                reviewer=request.user,
                decision=serializer.validated_data['decision'],
                notes=serializer.validated_data.get('notes'),
            )
        except DjangoValidationError as exc:
            _raise_drf_validation(exc)
        return Response(self.get_serializer(finalized).data)
