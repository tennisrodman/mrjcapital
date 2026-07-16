from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework import serializers

from api.models import (
    ClosingChecklistGeneration,
    ClosingPackage,
    ConditionPrecedent,
    DDChecklistItem,
    DDTemplate,
    DDTemplateItem,
    Document,
)
from api.serializers import AnalystSummarySerializer


User = get_user_model()


def _is_staff_user(user):
    return bool(user and (getattr(user, 'is_staff', False) or getattr(user, 'is_superuser', False)))


def _document_visible_to_user(user, document):
    if _is_staff_user(user):
        return True
    roles = document.visibility_roles or []
    return 'internal' in roles


class DDTemplateItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = DDTemplateItem
        fields = [
            'id',
            'sort_order',
            'kind',
            'title',
            'description',
            'default_days_before_target_close',
        ]


class DDTemplateSerializer(serializers.ModelSerializer):
    items = DDTemplateItemSerializer(many=True, read_only=True)

    class Meta:
        model = DDTemplate
        fields = ['id', 'key', 'name', 'description', 'is_active', 'items']


class ClosingPackageSerializer(serializers.ModelSerializer):
    class Meta:
        model = ClosingPackage
        fields = [
            'id',
            'deal',
            'target_close_date',
            'actual_close_date',
            'funds_wired_date',
            'funds_wired_amount',
            'closing_attorney',
            'title_company',
            'purchase_price',
            'appraised_value',
            'final_loan_amount',
            'closing_costs',
            'sources_and_uses_notes',
            'notes',
            'created_at',
            'updated_at',
        ]
        read_only_fields = fields


class ClosingPackageWriteSerializer(serializers.Serializer):
    deal = serializers.UUIDField(required=False)
    target_close_date = serializers.DateField(required=False, allow_null=True)
    actual_close_date = serializers.DateField(required=False, allow_null=True)
    funds_wired_date = serializers.DateField(required=False, allow_null=True)
    funds_wired_amount = serializers.DecimalField(max_digits=16, decimal_places=2, min_value=Decimal('0.01'), required=False, allow_null=True)
    closing_attorney = serializers.CharField(max_length=255, required=False, allow_blank=True)
    title_company = serializers.CharField(max_length=255, required=False, allow_blank=True)
    purchase_price = serializers.DecimalField(max_digits=16, decimal_places=2, min_value=Decimal('0'), required=False, allow_null=True)
    appraised_value = serializers.DecimalField(max_digits=16, decimal_places=2, min_value=Decimal('0'), required=False, allow_null=True)
    final_loan_amount = serializers.DecimalField(max_digits=16, decimal_places=2, min_value=Decimal('0.01'), required=False, allow_null=True)
    closing_costs = serializers.DecimalField(max_digits=16, decimal_places=2, min_value=Decimal('0'), required=False, allow_null=True)
    sources_and_uses_notes = serializers.CharField(required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)


class ClosingChecklistGenerationSerializer(serializers.ModelSerializer):
    generated_by_detail = AnalystSummarySerializer(source='generated_by', read_only=True)
    superseded_by_detail = AnalystSummarySerializer(source='superseded_by', read_only=True)

    class Meta:
        model = ClosingChecklistGeneration
        fields = [
            'id',
            'package',
            'version',
            'template',
            'template_key',
            'template_name',
            'is_current',
            'generated_at',
            'generated_by',
            'generated_by_detail',
            'superseded_at',
            'superseded_by',
            'superseded_by_detail',
            'supersede_reason',
        ]
        read_only_fields = fields


class ClosingDocumentSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = Document
        fields = [
            'id',
            'document_name',
            'category',
            'subcategory',
            'storage_status',
            'file_type',
            'file_size_bytes',
        ]


class VisibleDocumentsMixin:
    def get_documents(self, obj):
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        documents = list(obj.documents.all())
        if user is not None:
            documents = [doc for doc in documents if _document_visible_to_user(user, doc)]
        return ClosingDocumentSummarySerializer(documents, many=True).data


class DDChecklistItemSerializer(VisibleDocumentsMixin, serializers.ModelSerializer):
    documents = serializers.SerializerMethodField()
    owner_detail = AnalystSummarySerializer(source='owner', read_only=True)

    class Meta:
        model = DDChecklistItem
        fields = [
            'id',
            'generation',
            'source_template_item',
            'sort_order',
            'title',
            'description',
            'status',
            'owner',
            'owner_detail',
            'due_date',
            'waiver_reason',
            'completed_at',
            'completed_by',
            'waived_at',
            'waived_by',
            'documents',
            'created_by',
            'created_at',
            'updated_at',
        ]
        read_only_fields = fields


class ConditionPrecedentSerializer(VisibleDocumentsMixin, serializers.ModelSerializer):
    documents = serializers.SerializerMethodField()
    owner_detail = AnalystSummarySerializer(source='owner', read_only=True)

    class Meta:
        model = ConditionPrecedent
        fields = [
            'id',
            'generation',
            'source_template_item',
            'sort_order',
            'title',
            'description',
            'status',
            'owner',
            'owner_detail',
            'due_date',
            'waiver_reason',
            'satisfied_at',
            'satisfied_by',
            'waived_at',
            'waived_by',
            'documents',
            'created_by',
            'created_at',
            'updated_at',
        ]
        read_only_fields = fields


class ClosingItemCreateSerializer(serializers.Serializer):
    deal = serializers.UUIDField()
    title = serializers.CharField(max_length=255)
    description = serializers.CharField(required=False, allow_blank=True, default='')
    owner = serializers.IntegerField(required=False, allow_null=True)
    due_date = serializers.DateField(required=False, allow_null=True)


class ClosingItemUpdateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255, required=False)
    description = serializers.CharField(required=False, allow_blank=True)
    status = serializers.CharField(required=False)
    waiver_reason = serializers.CharField(required=False, allow_blank=True)
    owner = serializers.IntegerField(required=False, allow_null=True)
    due_date = serializers.DateField(required=False, allow_null=True)

    def validate(self, attrs):
        unknown = sorted(set(self.initial_data.keys()) - set(self.fields.keys()))
        if unknown:
            raise serializers.ValidationError({
                field: 'Unknown field.' for field in unknown
            })
        return attrs


class ClosingGenerateSerializer(serializers.Serializer):
    deal = serializers.UUIDField()
    template_id = serializers.UUIDField()
    force = serializers.BooleanField(required=False, default=False)
    force_reason = serializers.CharField(required=False, allow_blank=True, default='')
    target_close_date = serializers.DateField(required=False, allow_null=True)


class ClosingDocumentsSerializer(serializers.Serializer):
    document_ids = serializers.ListField(child=serializers.UUIDField(), allow_empty=True)


class ClosingAssigneeSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    username = serializers.CharField()
