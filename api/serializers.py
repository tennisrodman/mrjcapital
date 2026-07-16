from decimal import Decimal, InvalidOperation
import re
from uuid import UUID

from django.db import IntegrityError, transaction
from django.contrib.auth import get_user_model
from rest_framework import serializers

from api.models import (
    ActivityLog,
    Broker,
    Deal,
    DealNote,
    DealProperty,
    DealStageEvent,
    Document,
    DocumentCategory,
    Fund,
    InvestmentType,
    Property,
    Sponsor,
)
from api.services import normalize_address
from api.services.deals import (
    capture_deal_field_values,
    initialize_deal_stage_event,
    log_deal_field_updates,
)
from api.services.audit import SENSITIVE_SPONSOR_FIELDS
from api.services.deal_properties import replace_deal_properties


ALLOWED_DOCUMENT_VISIBILITY_ROLES = {'internal', 'investor', 'borrower', 'counsel'}
SUPPORTED_DEBT_INVESTMENT_TYPES = {
    InvestmentType.WHOLE_LOAN_BRIDGE,
    InvestmentType.WHOLE_LOAN_PERMANENT,
}


def _validate_supported_investment_type(value):
    if value not in SUPPORTED_DEBT_INVESTMENT_TYPES:
        raise serializers.ValidationError(
            'Only whole-loan debt investments are available in the current release.'
        )
    return value


def _validate_visibility_roles(value):
    if not isinstance(value, list):
        raise serializers.ValidationError('visibility_roles must be a list.')
    invalid_roles = sorted(set(value) - ALLOWED_DOCUMENT_VISIBILITY_ROLES)
    if invalid_roles:
        raise serializers.ValidationError(f'Unsupported visibility role(s): {", ".join(invalid_roles)}')
    return value



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
            'website',
            'years_experience',
            'completed_projects',
            'bankruptcy_history',
            'business_address',
            'total_units_owned',
            'total_sf_managed',
            'assets_under_management',
            'track_record',
            'connection_source',
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
            'default_commission_rate',
            'commission_type',
            'preferred_deal_types',
            'geographic_focus',
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
            'subtype',
            'units',
            'rentable_square_feet',
            'year_built',
            'year_renovated',
            'county',
            'msa',
            'number_of_buildings',
            'number_of_stories',
            'parking_spaces',
            'lot_size_acres',
            'flood_zone',
            'zoning_designation',
            'environmental_status',
            'details',
        ]

    def validate(self, attrs):
        address = attrs.get('address') or getattr(self.instance, 'address', '')
        city = attrs.get('city') or getattr(self.instance, 'city', '')
        state = attrs.get('state') or getattr(self.instance, 'state', '')
        zip_code = attrs.get('zip') or getattr(self.instance, 'zip', '')
        if 'state' in attrs:
            attrs['state'] = attrs['state'].upper()
        year_built = attrs.get('year_built', getattr(self.instance, 'year_built', None))
        year_renovated = attrs.get('year_renovated', getattr(self.instance, 'year_renovated', None))
        if year_built and year_renovated and year_renovated < year_built:
            raise serializers.ValidationError({
                'year_renovated': 'Year renovated cannot be earlier than year built.',
            })
        address_fields_changed = any(field in attrs for field in ['address', 'city', 'state', 'zip'])
        if self.instance is None or address_fields_changed:
            attrs['address_normalized'] = normalize_address(address, city, state, zip_code)
        normalized_address = attrs.get('address_normalized')
        if normalized_address is not None:
            existing = Property.objects.filter(address_normalized=normalized_address)
            if self.instance:
                existing = existing.exclude(pk=self.instance.pk)
            if existing.exists():
                match = existing.first()
                detail = {
                    'address_normalized': 'A property with this normalized address already exists.',
                }
                request = self.context.get('request')
                user = getattr(request, 'user', None) if request else None
                if match and _can_attach_property(user, match):
                    detail['existing_property'] = str(match.pk)
                raise serializers.ValidationError(detail)
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
        property_obj = attrs.get('property') or getattr(self.instance, 'property', None)
        if property_obj and not self.instance:
            request = self.context.get('request')
            user = getattr(request, 'user', None) if request else None
            if not _can_attach_property(user, property_obj):
                raise serializers.ValidationError({
                    'property': 'Selected property is not available.',
                })
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


class DealStageEventSerializer(serializers.ModelSerializer):
    performed_by_detail = AnalystSummarySerializer(source='performed_by', read_only=True)

    class Meta:
        model = DealStageEvent
        fields = [
            'id',
            'deal',
            'from_status',
            'to_status',
            'entered_at',
            'exited_at',
            'performed_by',
            'performed_by_detail',
            'reason',
            'is_override',
        ]
        read_only_fields = fields


class DealSerializer(serializers.ModelSerializer):
    investment_category = serializers.CharField(read_only=True)
    days_in_current_stage = serializers.IntegerField(read_only=True)
    properties = DealPropertySummarySerializer(source='deal_properties', many=True, read_only=True)
    property_ids = serializers.PrimaryKeyRelatedField(
        queryset=Property.objects.all(),
        many=True,
        required=False,
        write_only=True,
    )
    sponsor = serializers.PrimaryKeyRelatedField(
        queryset=Sponsor.objects.all(),
        required=False,
        allow_null=True,
    )
    broker = serializers.PrimaryKeyRelatedField(
        queryset=Broker.objects.all(),
        required=False,
        allow_null=True,
    )
    fund = serializers.PrimaryKeyRelatedField(
        queryset=Fund.objects.all(),
        required=False,
        allow_null=True,
    )
    assigned_analyst = serializers.PrimaryKeyRelatedField(
        queryset=get_user_model().objects.filter(is_active=True),
        required=False,
        allow_null=True,
    )
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
            'current_stage_entered_at',
            'days_in_current_stage',
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
            'purpose',
            'profile',
            'estimated_value',
            'renovation_budget',
            'description',
            'deposit_status',
            'deposit_received_date',
            'deposit_account_label',
            'deposit_refund_conditions',
            'exclusivity_granted',
            'exclusivity_expiry_date',
            'key_negotiation_changes',
            'details',
            'properties',
            'property_ids',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['current_stage_entered_at', 'created_at', 'updated_at']

    def validate_property_ids(self, value):
        if not value:
            raise serializers.ValidationError('property_ids must include at least one property when provided.')
        property_ids = [property_obj.pk for property_obj in value]
        if len(property_ids) != len(set(property_ids)):
            raise serializers.ValidationError('property_ids cannot contain duplicates.')
        request = self.context.get('request')
        user = getattr(request, 'user', None) if request else None
        for property_obj in value:
            if not _can_attach_property(user, property_obj):
                raise serializers.ValidationError('One or more selected properties are not available.')
        return value

    def validate_investment_type(self, value):
        return _validate_supported_investment_type(value)

    def validate_details(self, value):
        _reject_sensitive_details(value)
        return value

    def validate(self, attrs):
        if self.instance:
            request = self.context.get('request')
            user = getattr(request, 'user', None) if request else None
            if 'assigned_analyst' in attrs and not _is_staff_user(user):
                raise serializers.ValidationError({
                    'assigned_analyst': 'Only staff may reassign a deal.',
                })
            for field_name in ['sponsor', 'broker', 'fund']:
                if field_name not in attrs:
                    continue
                current_id = getattr(self.instance, f'{field_name}_id')
                incoming_obj = attrs[field_name]
                incoming_id = incoming_obj.pk if incoming_obj else None
                if current_id and incoming_id != current_id and not _is_staff_user(user):
                    raise serializers.ValidationError({
                        field_name: 'Only staff may change an existing relationship.',
                    })
                # Empty → set must use the same visibility rules as deal create.
                if not current_id and incoming_obj is not None:
                    if not _can_attach_related_entity(user, incoming_obj):
                        raise serializers.ValidationError({
                            field_name: 'Selected record is not available.',
                        })
        return attrs

    def create(self, validated_data):
        with transaction.atomic():
            property_ids = validated_data.pop('property_ids', [])
            deal = super().create(validated_data)
            initialize_deal_stage_event(deal, performed_by=self._request_user())
            replace_deal_properties(
                deal,
                property_ids,
                performed_by=self._request_user(),
                ip_address=self.context.get('audit_ip_address'),
            )
            return deal

    def update(self, instance, validated_data):
        with transaction.atomic():
            previous_values = capture_deal_field_values(instance, validated_data)
            has_property_ids = 'property_ids' in validated_data
            property_ids = validated_data.pop('property_ids', [])
            deal = super().update(instance, validated_data)
            if has_property_ids:
                replace_deal_properties(
                    deal,
                    property_ids,
                    performed_by=self._request_user(),
                    ip_address=self.context.get('audit_ip_address'),
                )
            log_deal_field_updates(
                deal,
                previous_values,
                performed_by=self._request_user(),
                ip_address=self.context.get('audit_ip_address'),
            )
            return deal

    def _request_user(self):
        request = self.context.get('request')
        return getattr(request, 'user', None) if request else None

class DealCreateSerializer(serializers.ModelSerializer):
    investment_category = serializers.CharField(read_only=True)
    sponsor = serializers.JSONField(required=False, allow_null=True)
    broker = serializers.JSONField(required=False, allow_null=True)
    properties = serializers.ListField(
        child=serializers.JSONField(),
        required=False,
        allow_empty=True,
        write_only=True,
    )
    property_ids = serializers.PrimaryKeyRelatedField(
        queryset=Property.objects.all(),
        many=True,
        required=False,
        write_only=True,
    )
    fund = serializers.PrimaryKeyRelatedField(
        queryset=Fund.objects.all(),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = Deal
        fields = [
            'id',
            'name',
            'investment_type',
            'investment_category',
            'sponsor',
            'broker',
            'fund',
            'source_channel',
            'source_date',
            'requested_amount',
            'purpose',
            'profile',
            'estimated_value',
            'renovation_budget',
            'description',
            'details',
            'properties',
            'property_ids',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'investment_category', 'created_at', 'updated_at']

    def validate_details(self, value):
        _reject_sensitive_details(value)
        return value

    def validate_investment_type(self, value):
        return _validate_supported_investment_type(value)

    def validate_fund(self, value):
        request = self.context.get('request')
        user = getattr(request, 'user', None) if request else None
        if not _can_attach_related_entity(user, value):
            raise serializers.ValidationError('Selected record is not available.')
        return value

    def validate(self, attrs):
        if 'properties' in attrs and 'property_ids' in attrs:
            raise serializers.ValidationError({
                'properties': 'Use either properties or property_ids, not both.',
            })

        attrs['_sponsor_input'] = self._validate_sponsor_input(attrs.pop('sponsor', None))

        if 'broker' in attrs:
            attrs['_broker_input'] = self._validate_broker_input(attrs.pop('broker'))

        property_inputs = []
        if 'property_ids' in attrs:
            property_inputs = [('existing', property_obj) for property_obj in attrs.pop('property_ids')]
            self._validate_unique_property_inputs(property_inputs, error_field='property_ids')
            request = self.context.get('request')
            user = getattr(request, 'user', None) if request else None
            for property_obj in (payload for _, payload in property_inputs):
                if not _can_attach_property(user, property_obj):
                    raise serializers.ValidationError({
                        'property_ids': 'One or more selected properties are not available.',
                    })
        elif 'properties' in attrs:
            property_inputs = self._validate_properties(attrs.pop('properties'))
        attrs['_property_inputs'] = property_inputs
        return attrs

    def create(self, validated_data):
        sponsor_input = validated_data.pop('_sponsor_input', None)
        broker_input = validated_data.pop('_broker_input', None)
        property_inputs = validated_data.pop('_property_inputs', [])
        with transaction.atomic():
            validated_data['sponsor'] = self._realize_nested_input(Sponsor, sponsor_input)
            if broker_input is not None:
                validated_data['broker'] = self._realize_nested_input(Broker, broker_input)
            deal = Deal.objects.create(**validated_data)
            request = self.context.get('request')
            initialize_deal_stage_event(
                deal,
                performed_by=getattr(request, 'user', None) if request else None,
            )
            properties = [
                self._realize_property_input(property_input, index)
                for index, property_input in enumerate(property_inputs)
            ]
            if properties:
                replace_deal_properties(
                    deal,
                    properties,
                    performed_by=getattr(request, 'user', None) if request else None,
                    ip_address=self.context.get('audit_ip_address'),
                )
            return deal

    def to_representation(self, instance):
        return DealSerializer(instance, context=self.context).data

    def _validate_sponsor_input(self, value):
        if value in (None, ''):
            return None
        if isinstance(value, str):
            sponsor = _resolve_existing_uuid(Sponsor, value, 'sponsor')
            self._require_related_entity_access(sponsor, 'sponsor')
            return ('existing', sponsor)
        if isinstance(value, dict):
            serializer = SponsorSerializer(data=value, context=self.context)
            try:
                serializer.is_valid(raise_exception=True)
            except serializers.ValidationError as exc:
                raise serializers.ValidationError({'sponsor': exc.detail}) from exc
            return ('new', serializer.validated_data)
        raise serializers.ValidationError({'sponsor': 'Expected an existing sponsor id, an object, or null.'})

    def _validate_broker_input(self, value):
        if value in (None, ''):
            return None
        if isinstance(value, str):
            broker = _resolve_existing_uuid(Broker, value, 'broker')
            self._require_related_entity_access(broker, 'broker')
            return ('existing', broker)
        if isinstance(value, dict):
            data = {'status': 'active', 'contact_name': '', **value}
            if not data.get('contact_name'):
                data['contact_name'] = data.get('company_name', '')
            serializer = BrokerSerializer(data=data, context=self.context)
            try:
                serializer.is_valid(raise_exception=True)
            except serializers.ValidationError as exc:
                raise serializers.ValidationError({'broker': exc.detail}) from exc
            return ('new', serializer.validated_data)
        raise serializers.ValidationError({'broker': 'Expected an existing broker id, an object, or null.'})

    def _require_related_entity_access(self, entity, field_name):
        request = self.context.get('request')
        user = getattr(request, 'user', None) if request else None
        if not _can_attach_related_entity(user, entity):
            raise serializers.ValidationError({
                field_name: 'Selected record is not available.',
            })

    def _validate_properties(self, values):
        property_inputs = []
        for index, value in enumerate(values or []):
            property_input = self._validate_property_input(value, index)
            property_inputs.append(property_input)
        self._validate_unique_property_inputs(property_inputs)
        return property_inputs

    def _validate_unique_property_inputs(self, property_inputs, error_field='properties'):
        seen = set()
        for index, property_input in enumerate(property_inputs):
            identity = self._property_identity(property_input)
            if identity in seen:
                raise serializers.ValidationError({
                    error_field: f'Property at index {index} duplicates another property on this deal.',
                })
            seen.add(identity)

    def _validate_property_input(self, value, index):
        if isinstance(value, str):
            property_obj = _resolve_existing_uuid(Property, value, f'properties[{index}]')
            request = self.context.get('request')
            user = getattr(request, 'user', None) if request else None
            if not _can_attach_property(user, property_obj):
                raise serializers.ValidationError({
                    'properties': {index: 'Selected property is not available.'},
                })
            return ('existing', property_obj)
        if isinstance(value, dict):
            serializer = PropertySerializer(data=value, context=self.context)
            try:
                serializer.is_valid(raise_exception=True)
            except serializers.ValidationError as exc:
                raise serializers.ValidationError({'properties': {index: exc.detail}}) from exc
            return ('new', serializer.validated_data)
        raise serializers.ValidationError({
            'properties': {index: 'Expected an existing property id or an object.'},
        })

    def _property_identity(self, property_input):
        kind, payload = property_input
        if kind == 'existing':
            return ('existing', payload.pk)
        return ('new', payload['address_normalized'])

    def _realize_nested_input(self, model_cls, nested_input):
        if nested_input is None:
            return None
        kind, payload = nested_input
        if kind == 'existing':
            return payload
        return model_cls.objects.create(**payload)

    def _realize_property_input(self, property_input, index):
        kind, payload = property_input
        if kind == 'existing':
            return payload
        try:
            with transaction.atomic():
                return Property.objects.create(**payload)
        except IntegrityError as exc:
            existing = Property.objects.filter(address_normalized=payload.get('address_normalized')).first()
            detail = {'address_normalized': 'A property with this normalized address already exists.'}
            request = self.context.get('request')
            user = getattr(request, 'user', None) if request else None
            if existing and _can_attach_property(user, existing):
                detail['existing_property'] = str(existing.pk)
            raise serializers.ValidationError({'properties': {index: detail}}) from exc


class PipelineTransitionSerializer(serializers.Serializer):
    to_status = serializers.CharField()
    reason = serializers.CharField(allow_blank=False)
    override_readiness = serializers.BooleanField(required=False, default=False)


class SyndicationTransitionSerializer(serializers.Serializer):
    to_status = serializers.CharField()
    reason = serializers.CharField(allow_blank=False)


class DocumentSerializer(serializers.ModelSerializer):
    uploaded_by = serializers.PrimaryKeyRelatedField(read_only=True)
    uploaded_by_username = serializers.CharField(source='uploaded_by.username', read_only=True)
    can_edit = serializers.SerializerMethodField()
    edit_block_reason = serializers.SerializerMethodField()
    can_delete = serializers.SerializerMethodField()
    delete_block_reason = serializers.SerializerMethodField()

    class Meta:
        model = Document
        fields = [
            'id',
            'deal',
            'document_name',
            'category',
            'subcategory',
            'version',
            'file_url',
            'file_type',
            'content_type',
            'file_size_bytes',
            'checksum_sha256',
            'storage_status',
            'pipeline_stage_at_upload',
            'uploaded_by',
            'uploaded_by_username',
            'uploaded_date',
            'is_executed',
            'expiry_date',
            'notes',
            'visibility_roles',
            'details',
            'can_edit',
            'edit_block_reason',
            'can_delete',
            'delete_block_reason',
        ]
        # file_type, content_type, and file_size_bytes are server-controlled
        # storage facts: keeping them read-only stops a client from PATCHing a
        # pending row to bypass the intent-time size cap or file-type whitelist.
        # visibility_roles is likewise fixed after intent so a non-staff uploader
        # cannot silently retag who can see a document. (deal/category/
        # document_name are held immutable by validate() so a change attempt is
        # an explicit 400 rather than a silent ignore.)
        read_only_fields = [
            'uploaded_by',
            'uploaded_by_username',
            'uploaded_date',
            'version',
            'file_url',
            'file_type',
            'content_type',
            'file_size_bytes',
            'is_executed',
            'storage_status',
            'pipeline_stage_at_upload',
            'checksum_sha256',
            'visibility_roles',
        ]
        # Documents are created only via upload-intent (POST is disabled), so the
        # (deal, category, document_name, version) uniqueness is enforced
        # server-side under a row lock plus the DB constraint. Disable DRF's
        # auto-generated UniqueTogetherValidator, which would otherwise fire on
        # the read-only `version` default.
        validators = []

    def validate(self, attrs):
        # deal / category / document_name form the storage-key identity; they are
        # fixed once the blob exists. (file_url and version are read-only.)
        if self.instance:
            for field_name in ('deal', 'category', 'document_name'):
                if field_name in attrs and attrs[field_name] != getattr(self.instance, field_name):
                    raise serializers.ValidationError(
                        {field_name: f'{field_name} cannot be changed after creation.'}
                    )
            from api.services.documents import locked_metadata_errors

            errors = locked_metadata_errors(self.instance, attrs)
            if errors:
                raise serializers.ValidationError(errors)
        return attrs

    def _action_capabilities(self, obj):
        from api.services.documents import document_action_capabilities

        request = self.context.get('request')
        user = getattr(request, 'user', None)
        cache = getattr(obj, '_document_capabilities_cache', {})
        cache_key = bool(user and getattr(user, 'is_staff', False))
        if cache_key not in cache:
            cache[cache_key] = document_action_capabilities(obj, user)
            obj._document_capabilities_cache = cache
        return cache[cache_key]

    def get_can_edit(self, obj):
        return self._action_capabilities(obj)['can_edit']

    def get_edit_block_reason(self, obj):
        return self._action_capabilities(obj)['edit_block_reason']

    def get_can_delete(self, obj):
        return self._action_capabilities(obj)['can_delete']

    def get_delete_block_reason(self, obj):
        return self._action_capabilities(obj)['delete_block_reason']

    def validate_visibility_roles(self, value):
        return _validate_visibility_roles(value)

    def validate_details(self, value):
        _reject_sensitive_details(value)
        return value


class DocumentUploadIntentSerializer(serializers.Serializer):
    deal = serializers.PrimaryKeyRelatedField(queryset=Deal.objects.all())
    document_name = serializers.CharField(max_length=255)
    category = serializers.ChoiceField(choices=DocumentCategory.choices)
    subcategory = serializers.CharField(max_length=64, required=False, allow_blank=True, default='')
    file_type = serializers.CharField(max_length=24)
    content_type = serializers.CharField(max_length=127, required=False, allow_blank=True, default='')
    file_size_bytes = serializers.IntegerField(min_value=1)
    visibility_roles = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        default=list,
    )
    notes = serializers.CharField(required=False, allow_blank=True, default='')
    expiry_date = serializers.DateField(required=False, allow_null=True, default=None)
    checksum_sha256 = serializers.CharField(required=False, allow_blank=True, default='')

    def validate_visibility_roles(self, value):
        return _validate_visibility_roles(value)

    def validate_file_size_bytes(self, value):
        from api.services.storage import max_upload_bytes

        cap = max_upload_bytes()
        if value > cap:
            raise serializers.ValidationError(f'File exceeds maximum upload size of {cap} bytes.')
        return value

    def validate(self, attrs):
        from api.services.storage import normalize_content_type, normalize_file_type

        try:
            attrs['file_type'] = normalize_file_type(attrs['file_type'])
        except ValueError as exc:
            raise serializers.ValidationError({'file_type': str(exc)}) from exc
        attrs['content_type'] = normalize_content_type(attrs['file_type'], attrs.get('content_type') or None)
        if not attrs.get('visibility_roles'):
            attrs['visibility_roles'] = ['internal']
        return attrs


class DocumentUploadCompleteSerializer(serializers.Serializer):
    checksum_sha256 = serializers.CharField(required=False, allow_blank=True, default='')


class DocumentDownloadSerializer(serializers.Serializer):
    download_url = serializers.URLField()
    expires_in = serializers.IntegerField()
    document_name = serializers.CharField()
    filename = serializers.CharField()
    content_type = serializers.CharField()
    file_size_bytes = serializers.IntegerField(allow_null=True)


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


class DealNoteSerializer(serializers.ModelSerializer):
    author = serializers.PrimaryKeyRelatedField(read_only=True)
    # author is nullable (SET_NULL on user deletion). A SerializerMethodField
    # always emits the key as a string-or-null, so the response shape is stable
    # across authored/orphaned notes and matches the Demo mock and the TS type.
    author_username = serializers.SerializerMethodField()
    attachments = serializers.PrimaryKeyRelatedField(
        many=True,
        required=False,
        queryset=Document.objects.all(),
        pk_field=serializers.UUIDField(),
    )

    class Meta:
        model = DealNote
        fields = [
            'id',
            'deal',
            'body',
            'author',
            'author_username',
            'attachments',
            'visibility_roles',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'author',
            'visibility_roles',
            'created_at',
            'updated_at',
        ]

    def get_author_username(self, obj):
        return obj.author.username if obj.author_id else None

    def validate_body(self, value):
        if not value or not value.strip():
            raise serializers.ValidationError('Note body cannot be empty.')
        return value

    def validate(self, attrs):
        # deal is fixed after creation; a change attempt is an explicit 400.
        if self.instance and 'deal' in attrs and attrs['deal'] != self.instance.deal:
            raise serializers.ValidationError({'deal': 'deal cannot be changed after creation.'})
        deal = attrs.get('deal') or getattr(self.instance, 'deal', None)
        attachments = attrs.get('attachments')
        if attachments and deal is not None:
            wrong = [str(doc.id) for doc in attachments if doc.deal_id != deal.id]
            if wrong:
                raise serializers.ValidationError(
                    {'attachments': f'Documents must belong to the same deal: {", ".join(wrong)}'}
                )
        return attrs


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


def _resolve_existing_uuid(model_cls, value, field_name):
    try:
        object_id = UUID(str(value))
    except (TypeError, ValueError) as exc:
        raise serializers.ValidationError({field_name: 'Invalid UUID.'}) from exc
    obj = model_cls.objects.filter(pk=object_id).first()
    if not obj:
        raise serializers.ValidationError({field_name: 'Selected record does not exist.'})
    return obj


def _is_staff_user(user):
    return bool(user and (getattr(user, 'is_staff', False) or getattr(user, 'is_superuser', False)))


def _can_attach_property(user, property_obj):
    """Staff may attach any property. Non-staff may attach orphans or properties
    already linked to one of their assigned deals — matching PropertyViewSet scope,
    plus unlinked rows so create-by-id of a freshly created property still works.
    """
    if _is_staff_user(user):
        return True
    if not user or not getattr(user, 'is_authenticated', False):
        return False
    linked = property_obj.deal_properties.select_related('deal').all()
    if not linked:
        return True
    return any(link.deal.assigned_analyst_id == user.id for link in linked)


def _can_attach_related_entity(user, entity):
    """Restrict existing Sponsor, Broker, and Fund relationships to visible records.

    Unlike properties, these entities have no safe orphan-attachment workflow for
    analysts. An unlinked record remains attachable so an analyst can use a
    record they just created through the supporting-entity API; linked records
    are available only to staff or to an analyst already assigned to one of
    their deals.
    """
    if _is_staff_user(user):
        return True
    if not user or not getattr(user, 'is_authenticated', False):
        return False
    related_deals = entity.deals.all()
    return not related_deals.exists() or related_deals.filter(assigned_analyst=user).exists()


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
