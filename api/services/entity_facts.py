"""Authorized, transactional updates for shared master-data records."""

from __future__ import annotations

import json
from decimal import Decimal

from django.core.exceptions import PermissionDenied
from django.db import transaction

from api.models import ActivityActionType, ActivityLog, Broker, Deal, Fund, Property, Sponsor
from api.policies import is_staff_user as _is_staff_user
from api.services.audit import SENSITIVE_SPONSOR_FIELDS


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

SPONSOR_UPDATE_FIELDS = frozenset({
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
    *SPONSOR_PROMOTED_FACT_FIELDS,
    'details',
})
PROPERTY_UPDATE_FIELDS = frozenset({
    'address_normalized',
    'address',
    'city',
    'state',
    'zip',
    'property_type',
    *PROPERTY_PROMOTED_FACT_FIELDS,
    'details',
})
BROKER_UPDATE_FIELDS = frozenset({
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
})
FUND_UPDATE_FIELDS = frozenset({'name', 'status', 'details'})

# Flexible details can contain future confidential values even though known
# sensitive keys are rejected at the serializer boundary. Never copy details
# from any master record, or encrypted Sponsor fields, into immutable evidence.
SPONSOR_REDACTED_AUDIT_FIELDS = frozenset(SENSITIVE_SPONSOR_FIELDS)
REDACTED_AUDIT_VALUE = '<redacted>'


def update_sponsor_facts(serializer, *, performed_by, ip_address=None):
    return _update_entity(
        serializer,
        performed_by=performed_by,
        ip_address=ip_address,
        subject_model='Sponsor',
        update_fields=SPONSOR_UPDATE_FIELDS,
        analyst_fields=SPONSOR_PROMOTED_FACT_FIELDS,
    )


def update_property_facts(serializer, *, performed_by, ip_address=None):
    return _update_entity(
        serializer,
        performed_by=performed_by,
        ip_address=ip_address,
        subject_model='Property',
        update_fields=PROPERTY_UPDATE_FIELDS,
        analyst_fields=PROPERTY_PROMOTED_FACT_FIELDS,
    )


def update_broker_facts(serializer, *, performed_by, ip_address=None):
    return _update_entity(
        serializer,
        performed_by=performed_by,
        ip_address=ip_address,
        subject_model='Broker',
        update_fields=BROKER_UPDATE_FIELDS,
    )


def update_fund_facts(serializer, *, performed_by, ip_address=None):
    return _update_entity(
        serializer,
        performed_by=performed_by,
        ip_address=ip_address,
        subject_model='Fund',
        update_fields=FUND_UPDATE_FIELDS,
    )


def _update_entity(
    serializer,
    *,
    performed_by,
    ip_address,
    subject_model,
    update_fields,
    analyst_fields=None,
):
    """Lock, authorize, update, and write one event per linked Deal."""
    model = type(serializer.instance)
    with transaction.atomic():
        instance = model.objects.select_for_update().get(pk=serializer.instance.pk)
        requested_fields = set(serializer.validated_data)
        unsupported = sorted(requested_fields - update_fields)
        if unsupported:
            raise TypeError(f'Unsupported {subject_model} update fields: {", ".join(unsupported)}')
        _require_update_access(
            instance,
            performed_by=performed_by,
            requested_fields=requested_fields,
            analyst_fields=analyst_fields,
        )
        changes = [
            (field_name, getattr(instance, field_name), value)
            for field_name, value in serializer.validated_data.items()
            if getattr(instance, field_name) != value
        ]
        serializer.instance = instance
        if not changes:
            return instance
        updated = serializer.save()
        _write_entity_logs(
            updated,
            changes=changes,
            performed_by=performed_by,
            ip_address=ip_address,
            subject_model=subject_model,
        )
        return updated


def _require_update_access(instance, *, performed_by, requested_fields, analyst_fields):
    if _is_staff_user(performed_by):
        return
    if analyst_fields is not None:
        forbidden_fields = sorted(requested_fields - analyst_fields)
        if forbidden_fields:
            raise PermissionDenied(
                'Analysts may update promoted underwriting facts only; identity, contact, '
                'relationship, address, and sensitive fields require staff access.'
            )
    if isinstance(instance, Property):
        is_shared = instance.deal_properties.exclude(deal__assigned_analyst=performed_by).exists()
        subject = 'Property'
    elif isinstance(instance, (Sponsor, Broker, Fund)):
        is_shared = instance.deals.exclude(assigned_analyst=performed_by).exists()
        subject = type(instance).__name__
    else:
        raise TypeError('Unsupported master-data subject.')
    if is_shared:
        raise PermissionDenied(f'A shared {subject} can only be changed by staff.')


def _write_entity_logs(instance, *, changes, performed_by, ip_address, subject_model):
    deal_ids = _linked_deal_ids(instance)
    contextual_deal_ids = deal_ids or [None]
    changed_fields = sorted(field_name for field_name, _old, _new in changes)
    old_values = {
        field_name: _audit_value(subject_model, field_name, old_value)
        for field_name, old_value, _new_value in changes
    }
    new_values = {
        field_name: _audit_value(subject_model, field_name, new_value)
        for field_name, _old_value, new_value in changes
    }
    ActivityLog.objects.bulk_create([
        ActivityLog(
            deal_id=deal_id,
            action_type=ActivityActionType.FIELD_UPDATED,
            performed_by=(
                performed_by if getattr(performed_by, 'is_authenticated', False) else None
            ),
            ip_address=ip_address,
            description=f'{subject_model} updated: {", ".join(changed_fields)}',
            old_value=json.dumps(old_values, sort_keys=True),
            new_value=json.dumps(new_values, sort_keys=True),
            metadata={
                'fields': changed_fields,
                'subject_model': subject_model,
                'subject_id': str(instance.pk),
            },
        )
        for deal_id in contextual_deal_ids
    ])


def _linked_deal_ids(instance):
    if isinstance(instance, Property):
        queryset = Deal.objects.filter(deal_properties__property=instance).distinct()
    elif isinstance(instance, Sponsor):
        queryset = Deal.objects.filter(sponsor=instance)
    elif isinstance(instance, Broker):
        queryset = Deal.objects.filter(broker=instance)
    elif isinstance(instance, Fund):
        queryset = Deal.objects.filter(fund=instance)
    else:
        raise TypeError('Unsupported master-data subject.')
    return list(queryset.order_by('pk').values_list('pk', flat=True))


def _audit_value(subject_model, field_name, value):
    if field_name == 'details' or (
        subject_model == 'Sponsor' and field_name in SPONSOR_REDACTED_AUDIT_FIELDS
    ):
        return REDACTED_AUDIT_VALUE
    if value is None:
        return None
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (str, int, float, bool, list, dict)):
        return value
    return str(value)
