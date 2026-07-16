from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from api.models.deal import Deal
from api.models.screening import ScreeningAssessment
from api.services.screening import (
    create_next_assessment,
    screening_is_complete,
    screening_missing_fields,
    update_draft_assessment,
)


class ScreeningReviewerSerializer(serializers.Serializer):
    id = serializers.IntegerField(read_only=True)
    username = serializers.CharField(read_only=True)


class ScreeningAssessmentSerializer(serializers.ModelSerializer):
    """Read/write serializer for a draft and read-only serializer for a final."""

    deal = serializers.PrimaryKeyRelatedField(queryset=Deal.objects.all(), required=False)
    reviewer = serializers.PrimaryKeyRelatedField(read_only=True)
    reviewer_detail = ScreeningReviewerSerializer(source='reviewer', read_only=True)
    is_current = serializers.SerializerMethodField(read_only=True)
    is_complete = serializers.SerializerMethodField(read_only=True)
    missing_fields = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = ScreeningAssessment
        fields = [
            'id',
            'deal',
            'version',
            'is_current',
            'is_complete',
            'missing_fields',
            'status',
            'reviewer',
            'reviewer_detail',
            'finalized_at',
            'decision',
            'notes',
            'loan_amount',
            'as_is_value',
            'stabilized_value',
            'project_cost',
            'noi',
            'stabilized_noi',
            'annual_debt_service',
            'occupancy',
            'proposed_rate',
            'proposed_term_months',
            'current_average_rent',
            'market_rent',
            'condition_rating',
            'unit_mix',
            'exit_strategy',
            'exit_cap_rate',
            'max_ltv',
            'max_ltc',
            'min_dscr',
            'min_debt_yield',
            'ltv_as_is',
            'ltv_stabilized',
            'ltc',
            'dscr',
            'debt_yield',
            'quick_score',
            'equity_summary',
            'equity_target_irr',
            'equity_target_multiple',
            'equity_target_hold_months',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'version',
            'status',
            'reviewer',
            'reviewer_detail',
            'finalized_at',
            'ltv_as_is',
            'ltv_stabilized',
            'ltc',
            'dscr',
            'debt_yield',
            'quick_score',
            'created_at',
            'updated_at',
        ]

    def validate(self, attrs):
        if self.instance is None and not attrs.get('deal'):
            raise serializers.ValidationError({'deal': 'A deal is required to create a screening assessment.'})

        if self.instance:
            if self.instance.status == ScreeningAssessment.Status.FINALIZED:
                raise serializers.ValidationError({
                    'status': 'Finalized screening assessments are immutable.',
                })
            incoming_deal = attrs.get('deal')
            if incoming_deal and incoming_deal.pk != self.instance.deal_id:
                raise serializers.ValidationError({
                    'deal': 'An assessment cannot be moved to another deal.',
                })
            # The deal is immutable after creation; retaining the same primary
            # key in a PUT is accepted but must not reach the service layer.
            attrs.pop('deal', None)
        return attrs

    def create(self, validated_data):
        deal = validated_data.pop('deal')
        try:
            return create_next_assessment(deal=deal, **validated_data)
        except DjangoValidationError as exc:
            _raise_django_validation(exc)

    def update(self, instance, validated_data):
        try:
            return update_draft_assessment(assessment=instance, **validated_data)
        except DjangoValidationError as exc:
            _raise_django_validation(exc)

    def get_is_current(self, obj):
        annotated_value = getattr(obj, 'is_current_annotation', None)
        return bool(annotated_value) if annotated_value is not None else obj.is_current

    def get_is_complete(self, obj):
        return screening_is_complete(obj)

    def get_missing_fields(self, obj):
        return screening_missing_fields(obj)


class ScreeningFinalizeSerializer(serializers.Serializer):
    decision = serializers.ChoiceField(choices=ScreeningAssessment.Decision.choices)
    notes = serializers.CharField(required=False, allow_blank=True)


def _raise_django_validation(exc):
    if hasattr(exc, 'message_dict'):
        raise serializers.ValidationError(exc.message_dict) from exc
    raise serializers.ValidationError({'detail': exc.messages}) from exc
