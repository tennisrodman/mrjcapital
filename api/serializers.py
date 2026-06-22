from decimal import Decimal, InvalidOperation
import posixpath
import re
from urllib.parse import urlparse

from django.db import transaction
from rest_framework import serializers

from api.models import (
    ActivityLog,
    Broker,
    Deal,
    DealProperty,
    Document,
    Fund,
    Property,
    Sponsor,
)
from api.services import normalize_address
from api.services.audit import SENSITIVE_SPONSOR_FIELDS


ALLOWED_DOCUMENT_VISIBILITY_ROLES = {'internal', 'investor', 'borrower', 'counsel'}
SENSITIVE_DETAIL_KEYS = {
    'account_number',
    'bank_account',
    'credit_score',
    'ein',
    'guarantor_credit_score',
    'guarantor_liquidity',
    'guarantor_net_worth',
    'liquidity',
    'net_worth',
    'routing_number',
    'ssn',
    'tax_id',
}
SENSITIVE_DETAIL_PATTERNS = [
    re.compile(r'\b\d{3}-\d{2}-\d{4}\b'),
    re.compile(r'\b\d{2}-\d{7}\b'),
]


class SponsorSerializer(serializers.ModelSerializer):
    ein = serializers.CharField(write_only=True, required=False, allow_blank=True)
    guarantor_net_worth = serializers.CharField(write_only=True, required=False, allow_blank=True)
    guarantor_liquidity = serializers.CharField(write_only=True, required=False, allow_blank=True)
    guarantor_credit_score = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = Sponsor
        fields = [
            'id',
            'entity_name',
            'entity_type',
            'primary_contact_name',
            'primary_contact_email',
            'primary_contact_phone',
            'relationship_rating',
            'ein',
            'guarantor_net_worth',
            'guarantor_liquidity',
            'guarantor_credit_score',
            'details',
        ]

    def validate_guarantor_net_worth(self, value):
        return _validate_decimal_string(value, 'guarantor_net_worth')

    def validate_guarantor_liquidity(self, value):
        return _validate_decimal_string(value, 'guarantor_liquidity')

    def validate_guarantor_credit_score(self, value):
        if value in (None, ''):
            return value
        try:
            return str(int(str(value)))
        except (TypeError, ValueError) as exc:
            raise serializers.ValidationError('guarantor_credit_score must be an integer.') from exc

    def validate_details(self, value):
        _reject_sensitive_details(value)
        return value


class SensitiveFieldReadSerializer(serializers.Serializer):
    fields = serializers.ListField(
        child=serializers.ChoiceField(choices=sorted(SENSITIVE_SPONSOR_FIELDS)),
        allow_empty=False,
    )
    reason = serializers.CharField(allow_blank=False)
    deal = serializers.PrimaryKeyRelatedField(queryset=Deal.objects.all(), required=False, allow_null=True)

    def validate(self, attrs):
        deal = attrs.get('deal')
        sponsor = self.context.get('sponsor')
        if deal and sponsor and deal.sponsor_id != sponsor.pk:
            raise serializers.ValidationError({'deal': 'Deal must belong to the sponsor whose fields are being read.'})
        return attrs


class BrokerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Broker
        fields = [
            'id',
            'company_name',
            'contact_name',
            'email',
            'phone',
            'status',
            'details',
        ]


class FundSerializer(serializers.ModelSerializer):
    class Meta:
        model = Fund
        fields = ['id', 'name', 'status', 'details']


class PropertySerializer(serializers.ModelSerializer):
    address_normalized = serializers.CharField(required=False, allow_blank=True)

    class Meta:
        model = Property
        fields = [
            'id',
            'address_normalized',
            'address',
            'city',
            'state',
            'zip',
            'property_type',
            'msa',
            'details',
        ]

    def validate(self, attrs):
        address = attrs.get('address') or getattr(self.instance, 'address', '')
        city = attrs.get('city') or getattr(self.instance, 'city', '')
        state = attrs.get('state') or getattr(self.instance, 'state', '')
        zip_code = attrs.get('zip') or getattr(self.instance, 'zip', '')
        if 'state' in attrs:
            attrs['state'] = attrs['state'].upper()
        if not attrs.get('address_normalized'):
            attrs['address_normalized'] = normalize_address(address, city, state, zip_code)
        existing = Property.objects.filter(address_normalized=attrs['address_normalized'])
        if self.instance:
            existing = existing.exclude(pk=self.instance.pk)
        if existing.exists():
            raise serializers.ValidationError({
                'address_normalized': 'A property with this normalized address already exists.',
                'existing_property': str(existing.first().pk),
            })
        return attrs


class DealPropertySerializer(serializers.ModelSerializer):
    property_detail = PropertySerializer(source='property', read_only=True)

    class Meta:
        model = DealProperty
        fields = ['id', 'deal', 'property', 'property_detail', 'is_primary']

    def validate(self, attrs):
        if self.instance:
            for field_name in ['deal', 'property']:
                if field_name in attrs and attrs[field_name] != getattr(self.instance, field_name):
                    raise serializers.ValidationError({field_name: 'This relationship cannot be changed after creation.'})
        deal = attrs.get('deal') or getattr(self.instance, 'deal', None)
        is_primary = attrs.get('is_primary', getattr(self.instance, 'is_primary', False))
        if deal and is_primary:
            existing = DealProperty.objects.filter(deal=deal, is_primary=True)
            if self.instance:
                existing = existing.exclude(pk=self.instance.pk)
            if existing.exists():
                raise serializers.ValidationError({'is_primary': 'A deal can have only one primary property.'})
        if (
            self.instance
            and self.instance.is_primary
            and attrs.get('is_primary') is False
        ):
            raise serializers.ValidationError({'is_primary': 'A deal with properties must have a primary property.'})
        return attrs


class DealPropertySummarySerializer(serializers.ModelSerializer):
    property = PropertySerializer(read_only=True)

    class Meta:
        model = DealProperty
        fields = ['id', 'property', 'is_primary']


class AnalystSummarySerializer(serializers.Serializer):
    """Minimal, read-only view of the assigned analyst (no PII beyond username)."""

    id = serializers.IntegerField(read_only=True)
    username = serializers.CharField(read_only=True)


class DealSerializer(serializers.ModelSerializer):
    investment_category = serializers.CharField(read_only=True)
    properties = DealPropertySummarySerializer(source='deal_properties', many=True, read_only=True)
    property_ids = serializers.PrimaryKeyRelatedField(
        queryset=Property.objects.all(),
        many=True,
        required=False,
        write_only=True,
    )
    assigned_analyst = serializers.PrimaryKeyRelatedField(read_only=True)
    # Read-only expansions so list/detail views can render names without N+1 lookups.
    # The writable FK fields above remain the canonical inputs; encrypted sponsor
    # fields stay write-only and never surface through sponsor_detail.
    sponsor_detail = SponsorSerializer(source='sponsor', read_only=True)
    broker_detail = BrokerSerializer(source='broker', read_only=True)
    fund_detail = FundSerializer(source='fund', read_only=True)
    assigned_analyst_detail = AnalystSummarySerializer(source='assigned_analyst', read_only=True)
    pipeline_status = serializers.CharField(read_only=True)
    syndication_status = serializers.CharField(read_only=True)
    paused_from_status = serializers.CharField(read_only=True)

    class Meta:
        model = Deal
        fields = [
            'id',
            'name',
            'investment_type',
            'investment_category',
            'pipeline_status',
            'syndication_status',
            'paused_from_status',
            'sponsor',
            'sponsor_detail',
            'broker',
            'broker_detail',
            'assigned_analyst',
            'assigned_analyst_detail',
            'fund',
            'fund_detail',
            'source_channel',
            'source_date',
            'requested_amount',
            'details',
            'properties',
            'property_ids',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']

    def validate_property_ids(self, value):
        if not value:
            raise serializers.ValidationError('property_ids must include at least one property when provided.')
        property_ids = [property_obj.pk for property_obj in value]
        if len(property_ids) != len(set(property_ids)):
            raise serializers.ValidationError('property_ids cannot contain duplicates.')
        return value

    def validate(self, attrs):
        if self.instance:
            for field_name in ['sponsor', 'broker', 'fund']:
                if field_name in attrs and attrs[field_name] != getattr(self.instance, field_name):
                    raise serializers.ValidationError({field_name: 'This relationship cannot be changed through this endpoint.'})
        return attrs

    def create(self, validated_data):
        with transaction.atomic():
            property_ids = validated_data.pop('property_ids', [])
            deal = super().create(validated_data)
            self._replace_properties(deal, property_ids)
            return deal

    def update(self, instance, validated_data):
        with transaction.atomic():
            has_property_ids = 'property_ids' in validated_data
            property_ids = validated_data.pop('property_ids', [])
            deal = super().update(instance, validated_data)
            if has_property_ids:
                self._replace_properties(deal, property_ids)
            return deal

    def _replace_properties(self, deal, properties):
        with transaction.atomic():
            DealProperty.objects.filter(deal=deal).delete()
            if not properties:
                return
            DealProperty.objects.bulk_create([
                DealProperty(deal=deal, property=property_obj, is_primary=index == 0)
                for index, property_obj in enumerate(properties)
            ])


class PipelineTransitionSerializer(serializers.Serializer):
    to_status = serializers.CharField()
    reason = serializers.CharField(allow_blank=False)


class SyndicationTransitionSerializer(serializers.Serializer):
    to_status = serializers.CharField()
    reason = serializers.CharField(allow_blank=False)


class DocumentSerializer(serializers.ModelSerializer):
    uploaded_by = serializers.PrimaryKeyRelatedField(read_only=True)

    class Meta:
        model = Document
        fields = [
            'id',
            'deal',
            'document_name',
            'category',
            'version',
            'file_url',
            'file_type',
            'uploaded_by',
            'uploaded_date',
            'is_executed',
            'expiry_date',
            'notes',
            'visibility_roles',
            'details',
        ]
        read_only_fields = ['uploaded_by', 'uploaded_date', 'version', 'is_executed']

    def validate(self, attrs):
        if self.instance and 'deal' in attrs and attrs['deal'] != self.instance.deal:
            raise serializers.ValidationError({'deal': 'Document deal cannot be changed after creation.'})
        return attrs

    def validate_file_url(self, value):
        parsed = urlparse(value)
        normalized = posixpath.normpath(value)
        if parsed.scheme or parsed.netloc or value.startswith(('/', '\\')) or normalized.startswith('../') or '/../' in value:
            raise serializers.ValidationError('file_url must be a relative storage path.')
        return value

    def validate_visibility_roles(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('visibility_roles must be a list.')
        invalid_roles = sorted(set(value) - ALLOWED_DOCUMENT_VISIBILITY_ROLES)
        if invalid_roles:
            raise serializers.ValidationError(f'Unsupported visibility role(s): {", ".join(invalid_roles)}')
        return value


class ActivityLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = ActivityLog
        fields = [
            'id',
            'deal',
            'action_type',
            'performed_by',
            'performed_at',
            'ip_address',
            'description',
            'old_value',
            'new_value',
            'reason',
            'metadata',
        ]
        read_only_fields = fields


def _validate_decimal_string(value, field_name):
    if value in (None, ''):
        return value
    try:
        decimal_value = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise serializers.ValidationError(f'{field_name} must be a decimal number.') from exc
    if not decimal_value.is_finite():
        raise serializers.ValidationError(f'{field_name} must be a finite decimal number.')
    return str(decimal_value)


def _reject_sensitive_details(value):
    def walk(node, path='details'):
        if isinstance(node, dict):
            for key, child in node.items():
                normalized_key = str(key).lower().replace('-', '_').replace(' ', '_')
                if normalized_key in SENSITIVE_DETAIL_KEYS:
                    raise serializers.ValidationError(f'{path}.{key} must use an encrypted first-class field.')
                walk(child, f'{path}.{key}')
        elif isinstance(node, list):
            for index, child in enumerate(node):
                walk(child, f'{path}[{index}]')
        elif isinstance(node, str):
            for pattern in SENSITIVE_DETAIL_PATTERNS:
                if pattern.search(node):
                    raise serializers.ValidationError(f'{path} appears to contain sensitive identifiers.')

    walk(value)
