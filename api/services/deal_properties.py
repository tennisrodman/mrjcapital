"""Transactional Deal ↔ Property relationship commands and audit history."""

from __future__ import annotations

import json

from django.db import transaction

from api.models import ActivityActionType, Deal, DealProperty
from api.services.audit import create_activity_log


def capture_deal_property_snapshot(deal):
    return [
        {
            'id': str(link.property_id),
            'address': link.property.address,
            'is_primary': link.is_primary,
        }
        for link in (
            DealProperty.objects
            .filter(deal=deal)
            .select_related('property')
            .order_by('-is_primary', 'property__address_normalized')
        )
    ]


def log_deal_property_change(
    deal,
    before,
    *,
    performed_by=None,
    ip_address=None,
):
    after = capture_deal_property_snapshot(deal)
    before_ids = [entry['id'] for entry in before]
    after_ids = [entry['id'] for entry in after]
    before_primary = next((entry for entry in before if entry['is_primary']), None)
    after_primary = next((entry for entry in after if entry['is_primary']), None)

    if before_ids == after_ids and before_primary == after_primary:
        return None

    attached_ids = [property_id for property_id in after_ids if property_id not in before_ids]
    detached_ids = [property_id for property_id in before_ids if property_id not in after_ids]
    primary_changed = (
        (before_primary or {}).get('id') != (after_primary or {}).get('id')
    )

    changes = []
    if attached_ids:
        changes.append(f'{len(attached_ids)} attached')
    if detached_ids:
        changes.append(f'{len(detached_ids)} detached')
    if primary_changed and after_primary:
        changes.append(f'primary changed to {after_primary["address"]}')
    if not changes:
        changes.append('relationship order updated')

    return create_activity_log(
        deal=deal,
        action_type=ActivityActionType.FIELD_UPDATED,
        performed_by=performed_by,
        ip_address=ip_address,
        description=f'Deal properties updated: {", ".join(changes)}',
        old_value=json.dumps(before, sort_keys=True),
        new_value=json.dumps(after, sort_keys=True),
        metadata={
            'field': 'property_ids',
            'subject_model': 'Deal',
            'subject_id': str(deal.pk),
            'attached_property_ids': attached_ids,
            'detached_property_ids': detached_ids,
            'previous_primary_property_id': (before_primary or {}).get('id'),
            'primary_property_id': (after_primary or {}).get('id'),
        },
    )


def replace_deal_properties(
    deal,
    properties,
    *,
    performed_by=None,
    ip_address=None,
):
    """Replace membership atomically; input order selects the primary property."""
    with transaction.atomic():
        locked_deal = Deal.objects.select_for_update().get(pk=deal.pk)
        before = capture_deal_property_snapshot(locked_deal)
        DealProperty.objects.filter(deal=locked_deal).delete()
        if properties:
            DealProperty.objects.bulk_create([
                DealProperty(
                    deal=locked_deal,
                    property=property_obj,
                    is_primary=index == 0,
                )
                for index, property_obj in enumerate(properties)
            ])
        log_deal_property_change(
            locked_deal,
            before,
            performed_by=performed_by,
            ip_address=ip_address,
        )
        return locked_deal
