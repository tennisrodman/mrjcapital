from django.contrib import admin
from django.conf import settings

from api.models import ActivityLog, Broker, Deal, DealProperty, Document, Fund, Property, Sponsor


class DealPropertyInline(admin.TabularInline):
    model = DealProperty
    extra = 0


@admin.register(Deal)
class DealAdmin(admin.ModelAdmin):
    list_display = ['name', 'investment_type', 'pipeline_status', 'syndication_status', 'requested_amount', 'source_date']
    list_filter = ['investment_type', 'pipeline_status', 'syndication_status', 'source_channel']
    search_fields = ['name', 'sponsor__entity_name', 'broker__company_name']
    readonly_fields = ['created_at', 'updated_at', 'investment_category']
    inlines = [DealPropertyInline]


@admin.register(Property)
class PropertyAdmin(admin.ModelAdmin):
    list_display = ['address', 'city', 'state', 'property_type', 'msa']
    list_filter = ['state', 'property_type']
    search_fields = ['address', 'address_normalized', 'city', 'msa']


@admin.register(Sponsor)
class SponsorAdmin(admin.ModelAdmin):
    list_display = ['entity_name', 'entity_type', 'primary_contact_name', 'primary_contact_email', 'relationship_rating']
    list_filter = ['entity_type', 'relationship_rating']
    search_fields = ['entity_name', 'primary_contact_name', 'primary_contact_email']
    exclude = ['ein', 'guarantor_net_worth', 'guarantor_liquidity', 'guarantor_credit_score']


@admin.register(Broker)
class BrokerAdmin(admin.ModelAdmin):
    list_display = ['company_name', 'contact_name', 'email', 'status']
    list_filter = ['status']
    search_fields = ['company_name', 'contact_name', 'email']


@admin.register(Fund)
class FundAdmin(admin.ModelAdmin):
    list_display = ['name', 'status']
    list_filter = ['status']
    search_fields = ['name']


@admin.register(Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = ['document_name', 'deal', 'category', 'version', 'uploaded_date', 'is_executed', 'expiry_date']
    list_filter = ['category', 'is_executed']
    search_fields = ['document_name', 'deal__name']


@admin.register(ActivityLog)
class ActivityLogAdmin(admin.ModelAdmin):
    list_display = ['action_type', 'deal', 'performed_by', 'performed_at', 'description']
    list_filter = ['action_type', 'performed_at']
    search_fields = ['deal__name', 'description']
    readonly_fields = [
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

    def has_add_permission(self, request):
        if settings.AUDIT_LOG_ADMIN_IMMUTABLE:
            return False
        return super().has_add_permission(request)

    def has_change_permission(self, request, obj=None):
        if settings.AUDIT_LOG_ADMIN_IMMUTABLE:
            return False
        return super().has_change_permission(request, obj)

    def has_delete_permission(self, request, obj=None):
        if settings.AUDIT_LOG_ADMIN_IMMUTABLE:
            return False
        return super().has_delete_permission(request, obj)

    def get_actions(self, request):
        actions = super().get_actions(request)
        if settings.AUDIT_LOG_ADMIN_IMMUTABLE:
            actions.pop('delete_selected', None)
        return actions
