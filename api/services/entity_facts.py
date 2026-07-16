"""Authorized, audited updates for promoted Sponsor and Property facts."""

from django.core.exceptions import PermissionDenied
from django.db import transaction

from api.models import ActivityActionType, ActivityLog, Deal, Property, Sponsor


SPONSOR_PROMOTED_FACT_FIELDS = frozenset({
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
})
PROPERTY_PROMOTED_FACT_FIELDS = frozenset({
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
})


def update_sponsor_facts(serializer, *, performed_by, ip_address=None):
    return _update_entity(
        serializer,
        performed_by=performed_by,
        ip_address=ip_address,
        subject_model='Sponsor',
        promoted_fields=SPONSOR_PROMOTED_FACT_FIELDS,
    )


def update_property_facts(serializer, *, performed_by, ip_address=None):
    return _update_entity(
        serializer,
        performed_by=performed_by,
        ip_address=ip_address,
        subject_model='Property',
        promoted_fields=PROPERTY_PROMOTED_FACT_FIELDS,
    )


def _update_entity(
    serializer,
    *,
    performed_by,
    ip_address,
    subject_model,
    promoted_fields,
):
    model = type(serializer.instance)
    with transaction.atomic():
        instance = model.objects.select_for_update().get(pk=serializer.instance.pk)
        _require_update_access(
            instance,
            performed_by=performed_by,
            requested_fields=set(serializer.validated_data),
            promoted_fields=promoted_fields,
        )
        previous_values = {
            field_name: getattr(instance, field_name)
            for field_name in promoted_fields
            if field_name in serializer.validated_data
        }
        serializer.instance = instance
        updated = serializer.save()
        changes = [
            (field_name, old_value, getattr(updated, field_name))
            for field_name, old_value in previous_values.items()
            if old_value != getattr(updated, field_name)
        ]
        if changes:
            _write_fact_logs(
                updated,
                changes=changes,
                performed_by=performed_by,
                ip_address=ip_address,
                subject_model=subject_model,
            )
        return updated


def _require_update_access(instance, *, performed_by, requested_fields, promoted_fields):
    if _is_staff_user(performed_by):
        return
    forbidden_fields = sorted(requested_fields - promoted_fields)
    if forbidden_fields:
        raise PermissionDenied(
            'Analysts may update promoted underwriting facts only; identity, contact, '
            'relationship, address, and sensitive fields require staff access.'
        )
    if isinstance(instance, Sponsor):
        is_shared = instance.deals.exclude(assigned_analyst=performed_by).exists()
    elif isinstance(instance, Property):
        is_shared = instance.deal_properties.exclude(deal__assigned_analyst=performed_by).exists()
    else:
        raise TypeError('Unsupported promoted-fact subject.')
    if is_shared:
        raise PermissionDenied('A shared Sponsor or Property can only be changed by staff.')


def _write_fact_logs(instance, *, changes, performed_by, ip_address, subject_model):
    if isinstance(instance, Sponsor):
        deal_ids = list(Deal.objects.filter(sponsor=instance).values_list('pk', flat=True))
    else:
        deal_ids = list(
            Deal.objects.filter(deal_properties__property=instance)
            .distinct()
            .values_list('pk', flat=True)
        )
    contextual_deal_ids = deal_ids or [None]
    ActivityLog.objects.bulk_create([
        ActivityLog(
            deal_id=deal_id,
            action_type=ActivityActionType.FIELD_UPDATED,
            performed_by=performed_by if getattr(performed_by, 'is_authenticated', False) else None,
            ip_address=ip_address,
            description=f'{subject_model} {field_name} updated',
            old_value=_audit_value(old_value),
            new_value=_audit_value(new_value),
            metadata={
                'field': field_name,
                'subject_model': subject_model,
                'subject_id': str(instance.pk),
            },
        )
        for deal_id in contextual_deal_ids
        for field_name, old_value, new_value in changes
    ])


def _audit_value(value):
    if value is None:
        return ''
    if isinstance(value, bool):
        return str(value).lower()
    return str(value)


def _is_staff_user(user):
    return bool(getattr(user, 'is_staff', False) or getattr(user, 'is_superuser', False))
