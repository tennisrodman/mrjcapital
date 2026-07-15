from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from api.models.deal import Deal
from api.models.quote import Quote
from api.services.quotes import create_next_quote, update_draft_quote


class QuoteCreatedBySerializer(serializers.Serializer):
    id = serializers.IntegerField(read_only=True)
    username = serializers.CharField(read_only=True)


class QuoteSerializer(serializers.ModelSerializer):
    """Read/write serializer for draft quotes; workflow fields are read-only."""

    deal = serializers.PrimaryKeyRelatedField(queryset=Deal.objects.all(), required=False)
    created_by = serializers.PrimaryKeyRelatedField(read_only=True)
    created_by_detail = QuoteCreatedBySerializer(source='created_by', read_only=True)
    is_current = serializers.SerializerMethodField(read_only=True)
    attachments = serializers.PrimaryKeyRelatedField(many=True, read_only=True)
    seed_from_screening = serializers.BooleanField(required=False, default=True, write_only=True)

    class Meta:
        model = Quote
        fields = [
            'id',
            'deal',
            'version',
            'is_current',
            'status',
            'is_counter',
            'created_by',
            'created_by_detail',
            'sent_at',
            'expires_at',
            'signed_at',
            'withdrawn_at',
            'notes',
            'loan_amount',
            'rate_type',
            'interest_rate',
            'index_name',
            'spread',
            'rate_floor',
            'term_months',
            'amortization_type',
            'amortization_months',
            'origination_fee_pct',
            'origination_fee_amount',
            'exit_fee_pct',
            'extension_options',
            'prepayment_terms',
            'recourse_type',
            'recourse_carveouts',
            'interest_reserve_months',
            'interest_reserve_amount',
            'holdback_amount',
            'initial_funding_amount',
            'good_faith_deposit',
            'min_dscr',
            'max_ltv',
            'min_debt_yield',
            'equity_commitment',
            'ownership_pct',
            'preferred_return_pct',
            'equity_summary',
            'attachments',
            'seed_from_screening',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'version',
            'status',
            'is_counter',
            'created_by',
            'created_by_detail',
            'sent_at',
            'signed_at',
            'withdrawn_at',
            'origination_fee_amount',
            'initial_funding_amount',
            'attachments',
            'created_at',
            'updated_at',
        ]

    def validate(self, attrs):
        if self.instance is None and not attrs.get('deal'):
            raise serializers.ValidationError({'deal': 'A deal is required to create a quote.'})

        if self.instance:
            if self.instance.status != Quote.Status.DRAFT:
                raise serializers.ValidationError({
                    'status': 'Non-draft quotes are immutable.',
                })
            incoming_deal = attrs.get('deal')
            if incoming_deal and incoming_deal.pk != self.instance.deal_id:
                raise serializers.ValidationError({
                    'deal': 'A quote cannot be moved to another deal.',
                })
            # The deal is immutable after creation; retaining the same primary
            # key in a PUT is accepted but must not reach the service layer.
            attrs.pop('deal', None)
            attrs.pop('seed_from_screening', None)
        return attrs

    def create(self, validated_data):
        deal = validated_data.pop('deal')
        seed_from_screening = validated_data.pop('seed_from_screening', True)
        request = self.context.get('request')
        created_by = getattr(request, 'user', None) if request else None
        try:
            return create_next_quote(
                deal=deal,
                created_by=created_by,
                seed_from_screening=seed_from_screening,
                **validated_data,
            )
        except DjangoValidationError as exc:
            _raise_django_validation(exc)

    def update(self, instance, validated_data):
        try:
            return update_draft_quote(instance, **validated_data)
        except DjangoValidationError as exc:
            _raise_django_validation(exc)

    def get_is_current(self, obj):
        annotated_value = getattr(obj, 'is_current_annotation', None)
        return bool(annotated_value) if annotated_value is not None else obj.is_current


class QuoteSendSerializer(serializers.Serializer):
    expires_at = serializers.DateTimeField(required=False, allow_null=True)


class QuoteAttachmentsSerializer(serializers.Serializer):
    document_ids = serializers.ListField(
        child=serializers.UUIDField(),
        allow_empty=True,
    )


def _raise_django_validation(exc):
    if hasattr(exc, 'message_dict'):
        raise serializers.ValidationError(exc.message_dict) from exc
    raise serializers.ValidationError({'detail': exc.messages}) from exc
