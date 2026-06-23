"""Load shared demo deal data into the database. Source: shared/demo_seed.json."""

from __future__ import annotations

import json
import uuid
from datetime import datetime
from decimal import Decimal
from pathlib import Path

from django.contrib.auth import get_user_model
from django.db import transaction
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

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
from api.models.choices import ActivityActionType

DEMO_NAMESPACE = uuid.UUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')
SEED_FILE = Path(__file__).resolve().parent.parent / 'shared' / 'demo_seed.json'


def demo_uuid(slug: str) -> uuid.UUID:
    return uuid.uuid5(DEMO_NAMESPACE, slug)


def load_seed_data() -> dict:
    with SEED_FILE.open(encoding='utf-8') as handle:
        return json.load(handle)


def _resolve_analyst():
    user_model = get_user_model()
    user = user_model.objects.filter(is_staff=True).order_by('id').first()
    if user:
        return user
    return user_model.objects.create_user(
        username='tchen',
        email='t@slow.rodeo',
        is_staff=True,
        password=user_model.objects.make_random_password(),
    )


@transaction.atomic
def seed_demo_data(*, stdout=None) -> dict[str, int]:
    data = load_seed_data()
    analyst = _resolve_analyst()
    counts = {
        'funds': 0,
        'sponsors': 0,
        'brokers': 0,
        'properties': 0,
        'deals': 0,
        'deal_properties': 0,
        'documents': 0,
        'activity_logs': 0,
    }

    funds: dict[str, Fund] = {}
    for row in data['funds']:
        fund, created = Fund.objects.update_or_create(
            id=demo_uuid(row['id']),
            defaults={
                'name': row['name'],
                'status': row['status'],
                'details': {},
            },
        )
        funds[row['id']] = fund
        if created:
            counts['funds'] += 1

    sponsors: dict[str, Sponsor] = {}
    for row in data['sponsors']:
        sponsor, created = Sponsor.objects.update_or_create(
            id=demo_uuid(row['id']),
            defaults={
                'entity_name': row['entity_name'],
                'entity_type': row['entity_type'],
                'primary_contact_name': row['primary_contact_name'],
                'primary_contact_email': row['primary_contact_email'],
                'primary_contact_phone': row.get('primary_contact_phone', ''),
                'relationship_rating': row['relationship_rating'],
                'details': {},
            },
        )
        sponsors[row['id']] = sponsor
        if created:
            counts['sponsors'] += 1

    brokers: dict[str, Broker] = {}
    for row in data['brokers']:
        broker, created = Broker.objects.update_or_create(
            id=demo_uuid(row['id']),
            defaults={
                'company_name': row['company_name'],
                'contact_name': row['contact_name'],
                'email': row['email'],
                'phone': row.get('phone', ''),
                'status': row['status'],
                'details': {},
            },
        )
        brokers[row['id']] = broker
        if created:
            counts['brokers'] += 1

    properties: dict[str, Property] = {}
    for row in data['properties']:
        address_normalized = f"{row['address']} {row['city']} {row['state']} {row['zip']}".upper()
        prop, created = Property.objects.update_or_create(
            id=demo_uuid(row['id']),
            defaults={
                'address_normalized': address_normalized,
                'address': row['address'],
                'city': row['city'],
                'state': row['state'],
                'zip': row['zip'],
                'property_type': row['property_type'],
                'msa': row.get('msa', ''),
                'details': {},
            },
        )
        properties[row['id']] = prop
        if created:
            counts['properties'] += 1

    deals: dict[str, Deal] = {}
    for row in data['deals']:
        source_date = parse_date(row['source_date'])
        if source_date is None:
            raise ValueError(f"Invalid source_date for deal {row['id']}: {row['source_date']}")

        deal, created = Deal.objects.update_or_create(
            id=demo_uuid(row['id']),
            defaults={
                'name': row['name'],
                'investment_type': row['investment_type'],
                'pipeline_status': row['pipeline_status'],
                'syndication_status': row['syndication_status'],
                'paused_from_status': row.get('paused_from_status'),
                'sponsor': sponsors[row['sponsor']],
                'broker': brokers[row['broker']] if row.get('broker') else None,
                'assigned_analyst': analyst,
                'fund': funds[row['fund']] if row.get('fund') else None,
                'source_channel': row['source_channel'],
                'source_date': source_date,
                'requested_amount': Decimal(row['requested_amount']),
                'details': {},
            },
        )
        deals[row['id']] = deal
        if created:
            counts['deals'] += 1

        for property_slug, is_primary in row['properties']:
            _, dp_created = DealProperty.objects.update_or_create(
                deal=deal,
                property=properties[property_slug],
                defaults={'is_primary': is_primary},
            )
            if dp_created:
                counts['deal_properties'] += 1

    uploaded_at = timezone.make_aware(datetime(2026, 5, 20, 16, 30))
    for row in data['documents']:
        deal_slug = row['deal']
        file_type = row['file_type']
        doc_id = row['id']
        expiry = parse_date(row['expiry_date']) if row.get('expiry_date') else None
        doc, created = Document.objects.update_or_create(
            id=demo_uuid(doc_id),
            defaults={
                'deal': deals[deal_slug],
                'document_name': row['document_name'],
                'category': row['category'],
                'version': row['version'],
                'file_url': f"deals/{deal_slug}/{doc_id}.{file_type}",
                'file_type': file_type,
                'uploaded_by': analyst,
                'is_executed': row['is_executed'],
                'expiry_date': expiry,
                'notes': '',
                'visibility_roles': ['internal'],
                'details': {},
            },
        )
        Document.objects.filter(pk=doc.pk).update(uploaded_date=uploaded_at)
        if created:
            counts['documents'] += 1

    for row in data['activity']:
        performed_at = parse_datetime(row['performed_at'])
        if performed_at is None:
            raise ValueError(f"Invalid performed_at for activity {row['id']}: {row['performed_at']}")
        if timezone.is_naive(performed_at):
            performed_at = timezone.make_aware(performed_at)

        log, created = ActivityLog.objects.update_or_create(
            id=demo_uuid(row['id']),
            defaults={
                'deal': deals[row['deal']],
                'action_type': ActivityActionType.STATUS_CHANGE,
                'performed_by': analyst,
                'ip_address': None,
                'description': row['description'],
                'old_value': row['old_value'],
                'new_value': row['new_value'],
                'reason': row['reason'],
                'metadata': {
                    'field': 'pipeline_status',
                    'from': row['old_value'],
                    'to': row['new_value'],
                },
            },
        )
        ActivityLog.objects.filter(pk=log.pk).update(performed_at=performed_at)
        if created:
            counts['activity_logs'] += 1

    if stdout:
        stdout.write(
            'Demo seed complete: '
            + ', '.join(f'{key}={value}' for key, value in counts.items() if value)
            + f' (analyst={analyst.username})'
        )

    return counts
