from decimal import Decimal, InvalidOperation
import posixpath
import re
from urllib.parse import urlparse

from django.db import IntegrityError, transaction
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


class InlineCreateValue:
    def __init__(self, serializer=None, instance=None):
        self.serializer = serializer
        self.instance = instance

    def save(self):
        if self.instance is not None:
            return self.instance
        return self.serializer.save()

    def matches(self, instance):
        if instance is None:
            return False
        if self.instance is not None and self.instance != instance:
            return False
        if self.serializer is None:
            return self.instance == instance
        for field_name, value in self.serializer.validated_data.items():
            if getattr(instance, field_name) != value:
                return False
        return True


class InlineCreateRelatedField(serializers.PrimaryKeyRelatedField):
    def __init__(self, *args, serializer_class=None, **kwargs):
        if serializer_class is None:
            raise TypeError('serializer_class is required.')
        self.serializer_class = serializer_class
        super().__init__(*args, **kwargs)

    def to_internal_value(self, data):
        if data == '' and self.allow_null:
            return None

        if isinstance(data, dict):
            instance = None
            payload = data.copy()
            object_id = payload.pop('id', None)
            if object_id not in (None, ''):
                instance = super().to_internal_value(object_id)
                if payload:
                    raise serializers.ValidationError(
                        'Relationship fields cannot be edited through this endpoint; send the id only.',
                    )
                return InlineCreateValue(instance=instance)

            if not payload and self.allow_null:
                return None

            if not payload:
                raise serializers.ValidationError('Provide an id or fields to create this relationship.')

            serializer = self.serializer_class(data=payload)
            serializer.is_valid(raise_exception=True)
            return InlineCreateValue(serializer=serializer)
        return super().to_internal_value(data)


class PropertySerializer(serializers.ModelSerializer):
    address_normalized = serializers.CharField(read_only=True)

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
            state = attrs['state']
        attrs['address_normalized'] = normalize_address(address, city, state, zip_code)
        existing = Property.objects.filter(address_normalized=attrs['address_normalized'])
        if self.instance:
            existing = existing.exclude(pk=self.instance.pk)
        existing_property = existing.first()
        if existing_property:
            raise serializers.ValidationError({
                'address_normalized': 'A property with this normalized address already exists.',
                'existing_property': str(existing_property.pk),
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


class DealPropertiesField(serializers.Field):
    default_error_messages = {
        'not_a_list': 'Expected a list of property ids or property objects.',
        'empty': 'Add at least one property.',
        'duplicate': 'Duplicate property in request.',
    }

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.pk_field = serializers.PrimaryKeyRelatedField(queryset=Property.objects.all())

    def to_internal_value(self, data):
        if not isinstance(data, list):
            self.fail('not_a_list')
        if not data:
            self.fail('empty')

        errors = {}
        properties = []
        seen_property_ids = set()
        seen_property_addresses = set()
        requested_property_ids = self._requested_property_ids(data)

        for index, item in enumerate(data):
            try:
                if isinstance(item, dict):
                    payload = item.copy()
                    object_id = payload.pop('id', None)
                    if object_id not in (None, ''):
                        property_obj = self.pk_field.to_internal_value(object_id)
                        if payload:
                            errors[index] = self._index_error(
                                'Property fields cannot be edited through this endpoint; send the id only.',
                            )
                            continue
                        self._append_existing_property(
                            properties,
                            property_obj,
                            seen_property_ids,
                            seen_property_addresses,
                            errors,
                            index,
                        )
                        continue

                    serializer = PropertySerializer(data=item)
                    try:
                        serializer.is_valid(raise_exception=True)
                    except serializers.ValidationError as exc:
                        existing_property_id = self._existing_property_id(exc.detail)
                        if (
                            existing_property_id
                            and (
                                existing_property_id in seen_property_ids
                                or existing_property_id in requested_property_ids
                            )
                        ):
                            errors[index] = self._index_error(self.error_messages['duplicate'])
                            continue
                        raise
                    address_normalized = serializer.validated_data.get('address_normalized')
                    if address_normalized in seen_property_addresses:
                        errors[index] = self._index_error(self.error_messages['duplicate'])
                    else:
                        seen_property_addresses.add(address_normalized)
                        properties.append(InlineCreateValue(serializer))
                    continue

                property_obj = self.pk_field.to_internal_value(item)
                self._append_existing_property(
                    properties,
                    property_obj,
                    seen_property_ids,
                    seen_property_addresses,
                    errors,
                    index,
                )
            except serializers.ValidationError as exc:
                errors[index] = self._index_error(exc.detail)

        if errors:
            raise serializers.ValidationError(errors)
        return properties

    def _append_existing_property(
        self,
        properties,
        property_obj,
        seen_property_ids,
        seen_property_addresses,
        errors,
        index,
    ):
        property_id = str(property_obj.pk)
        if property_id in seen_property_ids or property_obj.address_normalized in seen_property_addresses:
            errors[index] = self._index_error(self.error_messages['duplicate'])
            return
        seen_property_ids.add(property_id)
        seen_property_addresses.add(property_obj.address_normalized)
        properties.append(property_obj)

    def _index_error(self, detail):
        if isinstance(detail, dict):
            return detail
        if not isinstance(detail, list):
            detail = [detail]
        return {'non_field_errors': detail}

    def _existing_property_id(self, detail):
        if not isinstance(detail, dict) or 'existing_property' not in detail:
            return None
        value = detail['existing_property']
        if isinstance(value, list):
            value = value[0]
        return str(value)

    def _requested_property_ids(self, data):
        property_ids = set()
        for item in data:
            object_id = item.get('id') if isinstance(item, dict) else item
            if object_id not in (None, ''):
                property_ids.add(str(object_id))
        return property_ids

    def to_representation(self, value):
        if hasattr(value, 'all'):
            value = value.all()
        return DealPropertySummarySerializer(value, many=True, context=self.context).data


class AnalystSummarySerializer(serializers.Serializer):
    """Minimal, read-only view of the assigned analyst (no PII beyond username)."""

    id = serializers.IntegerField(read_only=True)
    username = serializers.CharField(read_only=True)


class DealSerializer(serializers.ModelSerializer):
    investment_category = serializers.CharField(read_only=True)
    sponsor = InlineCreateRelatedField(queryset=Sponsor.objects.all(), serializer_class=SponsorSerializer)
    broker = InlineCreateRelatedField(
        queryset=Broker.objects.all(),
        serializer_class=BrokerSerializer,
        required=False,
        allow_null=True,
    )
    properties = DealPropertiesField(source='deal_properties', required=False)
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
        return value

    def validate(self, attrs):
        if 'property_ids' in attrs and 'deal_properties' in attrs:
            raise serializers.ValidationError({
                'properties': 'Use either properties or property_ids, not both.',
            })
        if not self.instance and 'property_ids' not in attrs and 'deal_properties' not in attrs:
            raise serializers.ValidationError({'properties': 'Add at least one property.'})
        if 'property_ids' in attrs:
            self._validate_property_selection(attrs['property_ids'])
        if self.instance:
            self._validate_immutable_relationships(attrs)
        return attrs

    def _validate_immutable_relationships(self, attrs):
        for field_name in ['sponsor', 'broker']:
            if field_name not in attrs:
                continue
            current_value = getattr(self.instance, field_name)
            incoming_value = attrs[field_name]
            if (
                isinstance(incoming_value, InlineCreateValue)
                and incoming_value.serializer is not None
            ):
                raise serializers.ValidationError({
                    field_name: 'Relationship fields cannot be edited through this endpoint; send the id only.',
                })
            if (
                isinstance(incoming_value, InlineCreateValue)
                and incoming_value.matches(current_value)
            ):
                attrs[field_name] = current_value
                continue
            if incoming_value != current_value:
                raise serializers.ValidationError({
                    field_name: 'This relationship cannot be changed through this endpoint.',
                })

        if 'fund' in attrs:
            incoming_fund = attrs['fund']
            if incoming_fund is not None and incoming_fund != self.instance.fund:
                raise serializers.ValidationError({
                    'fund': 'This relationship cannot be changed through this endpoint.',
                })

    def _validate_property_selection(self, properties):
        if not properties:
            raise serializers.ValidationError({'properties': 'Add at least one property.'})

        errors = {}
        seen_property_ids = set()
        seen_property_addresses = set()
        for index, property_obj in enumerate(properties):
            property_id = str(property_obj.pk)
            if property_id in seen_property_ids or property_obj.address_normalized in seen_property_addresses:
                errors[index] = {'non_field_errors': ['Duplicate property in request.']}
            seen_property_ids.add(property_id)
            seen_property_addresses.add(property_obj.address_normalized)
        if errors:
            raise serializers.ValidationError({'properties': errors})

    def create(self, validated_data):
        with transaction.atomic():
            properties = self._pop_properties(validated_data)
            sponsor = validated_data.get('sponsor')
            if sponsor is None:
                raise serializers.ValidationError({'sponsor': 'This field is required.'})
            validated_data['sponsor'] = self._save_inline_create(sponsor)
            if 'broker' in validated_data:
                validated_data['broker'] = self._save_inline_create(validated_data['broker'])
            deal = super().create(validated_data)
            self._replace_properties(deal, properties)
            return deal

    def update(self, instance, validated_data):
        with transaction.atomic():
            has_properties = 'property_ids' in validated_data or 'deal_properties' in validated_data
            properties = self._pop_properties(validated_data)
            deal = super().update(instance, validated_data)
            if has_properties:
                self._replace_properties(deal, properties)
            return deal

    def _pop_properties(self, validated_data):
        properties = validated_data.pop('deal_properties', None)
        property_ids = validated_data.pop('property_ids', None)
        return [
            self._save_inline_create(value)
            for value in (properties if properties is not None else property_ids or [])
        ]

    def _save_inline_create(self, value):
        if isinstance(value, InlineCreateValue):
            return value.save()
        return value

    def _replace_properties(self, deal, properties):
        try:
            with transaction.atomic():
                DealProperty.objects.filter(deal=deal).delete()
                if not properties:
                    self._clear_prefetched_properties(deal)
                    return
                DealProperty.objects.bulk_create([
                    DealProperty(deal=deal, property=property_obj, is_primary=index == 0)
                    for index, property_obj in enumerate(properties)
                ])
                self._clear_prefetched_properties(deal)
        except IntegrityError as exc:
            if not self._is_deal_property_integrity_conflict(exc):
                raise
            raise serializers.ValidationError({
                'properties': 'Could not attach properties to the deal. Please retry.',
            }) from exc

    def _is_deal_property_integrity_conflict(self, exc):
        constraint_name = ''
        cause = getattr(exc, '__cause__', None)
        cause_diag = getattr(cause, 'diag', None)
        if cause_diag is not None:
            constraint_name = getattr(cause_diag, 'constraint_name', '') or ''
        constraint_name = constraint_name.lower()

        conflict_markers = {
            'unique_deal_property',
            'unique_primary_property_per_deal',
            'api_dealproperty.deal_id, api_dealproperty.property_id',
            'api_dealproperty.deal_id',
        }
        message = ' '.join(str(arg) for arg in exc.args).lower()
        return any(marker in constraint_name or marker in message for marker in conflict_markers)

    def _clear_prefetched_properties(self, deal):
        if getattr(deal, '_prefetched_objects_cache', None):
            deal._prefetched_objects_cache.pop('deal_properties', None)


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
