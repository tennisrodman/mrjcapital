"""Versioned, append-only showcase data seeding.

This dataset is intentionally shallower than the service-driven lifecycle
scenarios: it recreates the realistic pipeline board that was assembled in the
local database without pretending that every historical deal has complete
workflow evidence.
"""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils.dateparse import parse_date, parse_datetime

from api.models import (
    Broker,
    Deal,
    DealStageEvent,
    Fund,
    Property,
    Sponsor,
)
from api.services.address import normalize_address
from api.services.deal_properties import replace_deal_properties


SHOWCASE_SCHEMA_VERSION = 1
DEFAULT_SHOWCASE_MANIFEST_PATH = (
    Path(__file__).resolve().parents[2] / 'shared' / 'showcase_seed.v1.json'
)
_KEY_PATTERN = re.compile(r'^[a-z0-9][a-z0-9_-]*$')
_SECTIONS = ('sponsors', 'brokers', 'funds', 'properties', 'deals')
_MARKER_FIELDS = {'id', 'key'}

_FIELDS = {
    'sponsors': {
        'entity_name', 'entity_type', 'primary_contact_name',
        'primary_contact_email', 'primary_contact_phone', 'relationship_rating',
    },
    'brokers': {
        'company_name', 'contact_name', 'email', 'phone', 'status',
    },
    'funds': {'name', 'status'},
    'properties': {
        'address', 'city', 'state', 'zip', 'property_type', 'subtype', 'msa',
    },
    'deals': {
        'name', 'investment_type', 'pipeline_status', 'syndication_status',
        'paused_from_status', 'sponsor_key', 'broker_key', 'fund_key',
        'source_channel', 'source_date', 'requested_amount', 'property_keys',
        'current_stage_entered_at',
    },
}
_REQUIRED = {
    'sponsors': {
        'entity_name', 'entity_type', 'primary_contact_name',
        'primary_contact_email', 'relationship_rating',
    },
    'brokers': {'company_name', 'contact_name', 'email', 'status'},
    'funds': {'name', 'status'},
    'properties': {'address', 'city', 'state', 'zip', 'property_type'},
    'deals': {
        'name', 'investment_type', 'pipeline_status', 'syndication_status',
        'source_channel', 'source_date', 'requested_amount', 'property_keys',
        'current_stage_entered_at',
    },
}


@dataclass(frozen=True)
class ShowcaseManifest:
    schema_version: int
    dataset_key: str
    sections: dict[str, tuple[dict, ...]]
    path: Path


@dataclass(frozen=True)
class ShowcaseSeedResult:
    dataset_key: str
    created: dict[str, int]
    existing: dict[str, int]
    pipeline: dict[str, int]


def _validation_error(field, message):
    raise ValidationError({field: message})


def _parse_uuid(value, field):
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError, AttributeError) as exc:
        raise ValidationError({field: 'Expected a UUID.'}) from exc


def _validate_key(value, field):
    if not isinstance(value, str) or not _KEY_PATTERN.fullmatch(value):
        _validation_error(
            field,
            'Use lowercase letters, numbers, hyphens, or underscores.',
        )


def load_showcase_manifest(path=None):
    manifest_path = Path(path or DEFAULT_SHOWCASE_MANIFEST_PATH).expanduser().resolve()
    try:
        raw = json.loads(manifest_path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValidationError({'manifest': f'Unable to load showcase manifest: {exc}.'}) from exc
    if not isinstance(raw, dict):
        _validation_error('manifest', 'Expected an object.')
    unknown_sections = sorted(set(raw) - {'schema_version', 'dataset_key', *_SECTIONS})
    if unknown_sections:
        _validation_error('manifest', f'Unknown fields: {", ".join(unknown_sections)}.')
    if raw.get('schema_version') != SHOWCASE_SCHEMA_VERSION:
        _validation_error(
            'schema_version',
            f'Expected schema {SHOWCASE_SCHEMA_VERSION}; got {raw.get("schema_version")!r}.',
        )
    dataset_key = raw.get('dataset_key')
    _validate_key(dataset_key, 'dataset_key')

    sections = {}
    all_ids = set()
    keys_by_section = {}
    for section in _SECTIONS:
        rows = raw.get(section)
        if not isinstance(rows, list) or not rows:
            _validation_error(section, 'Expected a non-empty list.')
        parsed_rows = []
        seen_keys = set()
        for index, row in enumerate(rows):
            field = f'{section}[{index}]'
            if not isinstance(row, dict):
                _validation_error(field, 'Expected an object.')
            unknown = sorted(set(row) - _MARKER_FIELDS - _FIELDS[section])
            if unknown:
                _validation_error(field, f'Unknown fields: {", ".join(unknown)}.')
            missing = sorted({'id', 'key', *_REQUIRED[section]} - set(row))
            if missing:
                _validation_error(field, f'Missing fields: {", ".join(missing)}.')
            key = row['key']
            _validate_key(key, f'{field}.key')
            if key in seen_keys:
                _validation_error(section, f'Duplicate key: {key}.')
            object_id = _parse_uuid(row['id'], f'{field}.id')
            if object_id in all_ids:
                _validation_error('manifest', f'Duplicate UUID: {object_id}.')
            seen_keys.add(key)
            all_ids.add(object_id)
            parsed_rows.append({**row, 'id': object_id})
        sections[section] = tuple(parsed_rows)
        keys_by_section[section] = seen_keys

    for index, deal in enumerate(sections['deals']):
        for relation, target_section in (
            ('sponsor_key', 'sponsors'),
            ('broker_key', 'brokers'),
            ('fund_key', 'funds'),
        ):
            value = deal.get(relation)
            if value is not None and value not in keys_by_section[target_section]:
                _validation_error(f'deals[{index}].{relation}', f'Unknown key: {value}.')
        property_keys = deal.get('property_keys')
        if not isinstance(property_keys, list) or not property_keys:
            _validation_error(f'deals[{index}].property_keys', 'Expected a non-empty list.')
        if len(property_keys) != len(set(property_keys)):
            _validation_error(f'deals[{index}].property_keys', 'Duplicate property key.')
        missing_properties = sorted(set(property_keys) - keys_by_section['properties'])
        if missing_properties:
            _validation_error(
                f'deals[{index}].property_keys',
                f'Unknown keys: {", ".join(missing_properties)}.',
            )

    return ShowcaseManifest(
        schema_version=SHOWCASE_SCHEMA_VERSION,
        dataset_key=dataset_key,
        sections=sections,
        path=manifest_path,
    )


def _marker(manifest, key):
    return {
        'showcase_seed': True,
        'seed_dataset': manifest.dataset_key,
        'seed_key': key,
        'seed_schema_version': manifest.schema_version,
    }


def _convert_fields(section, row):
    fields = {
        name: value
        for name, value in row.items()
        if name not in _MARKER_FIELDS
    }
    if section == 'properties':
        fields['address_normalized'] = normalize_address(
            fields['address'],
            fields['city'],
            fields['state'],
            fields['zip'],
        )
    elif section == 'deals':
        fields['source_date'] = parse_date(fields['source_date'])
        fields['current_stage_entered_at'] = parse_datetime(fields['current_stage_entered_at'])
        try:
            fields['requested_amount'] = Decimal(str(fields['requested_amount']))
        except Exception as exc:
            raise ValidationError({'requested_amount': 'Expected a decimal amount.'}) from exc
        if not isinstance(fields['source_date'], date):
            _validation_error('source_date', 'Expected an ISO date.')
        if not isinstance(fields['current_stage_entered_at'], datetime):
            _validation_error('current_stage_entered_at', 'Expected an ISO datetime.')
    return fields


def _validate_existing(instance, expected, field, manifest, key):
    marker = instance.details or {}
    tagged_dataset = marker.get('seed_dataset')
    if tagged_dataset and tagged_dataset != manifest.dataset_key:
        _validation_error(field, 'Deterministic seed identity belongs to another dataset.')
    tagged_key = marker.get('seed_key')
    if tagged_key and tagged_key != key:
        _validation_error(field, 'Deterministic seed identity belongs to another seed key.')
    tagged_version = marker.get('seed_schema_version')
    if tagged_version and tagged_version != manifest.schema_version:
        _validation_error(field, 'Seeded record uses a different showcase schema version.')
    changed = sorted(
        name for name, expected_value in expected.items()
        if getattr(instance, name) != expected_value
    )
    if changed:
        _validation_error(
            field,
            f'Existing record conflicts with showcase data: {", ".join(changed)}.',
        )


def _natural_collision(model, instance_id, lookup, field):
    collision = model.objects.filter(**lookup).exclude(pk=instance_id).first()
    if collision is not None:
        _validation_error(field, 'A different record already uses this business identity.')


def _seed_tag_collision(model, instance_id, manifest, key, field):
    collision = (
        model.objects
        .filter(details__seed_dataset=manifest.dataset_key, details__seed_key=key)
        .exclude(pk=instance_id)
        .exists()
    )
    if collision:
        _validation_error(field, 'Seed key is already attached to a different record.')


def _get_or_create_master(model, section, row, manifest):
    expected = _convert_fields(section, row)
    _seed_tag_collision(
        model,
        row['id'],
        manifest,
        row['key'],
        f'{section}.{row["key"]}',
    )
    if section == 'sponsors':
        _natural_collision(
            model,
            row['id'],
            {'primary_contact_email': expected['primary_contact_email']},
            f'{section}.{row["key"]}',
        )
    elif section == 'brokers':
        _natural_collision(
            model,
            row['id'],
            {'email': expected['email']},
            f'{section}.{row["key"]}',
        )
    elif section == 'funds':
        _natural_collision(
            model,
            row['id'],
            {'name': expected['name']},
            f'{section}.{row["key"]}',
        )
    elif section == 'properties':
        _natural_collision(
            model,
            row['id'],
            {
                'address': expected['address'],
                'city': expected['city'],
                'state': expected['state'],
                'zip': expected['zip'],
            },
            f'{section}.{row["key"]}',
        )

    existing = model.objects.select_for_update().filter(pk=row['id']).first()
    if existing is not None:
        validation_expected = expected
        if section == 'properties':
            # The local showcase predates the current canonical address
            # normalizer. Business address fields, rather than that derived
            # cache, define whether it is the same property.
            validation_expected = {
                name: value
                for name, value in expected.items()
                if name != 'address_normalized'
            }
        _validate_existing(
            existing,
            validation_expected,
            f'{section}.{row["key"]}',
            manifest,
            row['key'],
        )
        return existing, False
    instance = model(pk=row['id'], details=_marker(manifest, row['key']), **expected)
    instance.full_clean()
    instance.save(force_insert=True)
    return instance, True


def _get_or_create_deal(row, manifest, actor, masters):
    raw_fields = _convert_fields('deals', row)
    property_keys = raw_fields.pop('property_keys')
    sponsor_key = raw_fields.pop('sponsor_key', None)
    broker_key = raw_fields.pop('broker_key', None)
    fund_key = raw_fields.pop('fund_key', None)
    expected = {
        **raw_fields,
        'sponsor_id': masters['sponsors'].get(sponsor_key).pk if sponsor_key else None,
        'broker_id': masters['brokers'].get(broker_key).pk if broker_key else None,
        'fund_id': masters['funds'].get(fund_key).pk if fund_key else None,
    }
    _seed_tag_collision(
        Deal,
        row['id'],
        manifest,
        row['key'],
        f'deals.{row["key"]}',
    )
    _natural_collision(
        Deal,
        row['id'],
        {'name': expected['name']},
        f'deals.{row["key"]}',
    )
    existing = Deal.objects.select_for_update().filter(pk=row['id']).first()
    properties = [masters['properties'][key] for key in property_keys]
    if existing is not None:
        _validate_existing(
            existing,
            expected,
            f'deals.{row["key"]}',
            manifest,
            row['key'],
        )
        actual_links = list(
            existing.deal_properties
            .order_by('-is_primary', 'property__address_normalized')
            .values_list('property_id', 'is_primary')
        )
        expected_links = [
            (property_obj.pk, index == 0)
            for index, property_obj in enumerate(properties)
        ]
        if actual_links != expected_links:
            _validation_error(
                f'deals.{row["key"]}.property_keys',
                'Existing property relationships conflict with showcase data.',
            )
        open_stage = existing.stage_events.filter(exited_at__isnull=True).first()
        if open_stage is None or open_stage.to_status != existing.pipeline_status:
            _validation_error(
                f'deals.{row["key"]}.pipeline_status',
                'Existing current-stage history conflicts with showcase data.',
            )
        return existing, False

    deal = Deal(
        pk=row['id'],
        assigned_analyst=actor,
        details=_marker(manifest, row['key']),
        **expected,
    )
    deal.full_clean()
    deal.save(force_insert=True)
    replace_deal_properties(deal, properties, performed_by=actor)
    DealStageEvent.objects.create(
        pk=uuid.uuid5(
            uuid.NAMESPACE_URL,
            f'mrj:{manifest.dataset_key}:deal-stage:{row["key"]}',
        ),
        deal=deal,
        to_status=deal.pipeline_status,
        entered_at=deal.current_stage_entered_at,
        performed_by=actor,
        reason='Imported from the versioned showcase dataset.',
        is_override=True,
    )
    return deal, True


@transaction.atomic
def seed_showcase_dataset(*, actor, manifest=None):
    if (
        not getattr(actor, 'is_authenticated', False)
        or not actor.is_active
        or not actor.is_staff
    ):
        _validation_error('actor', 'An active staff actor is required.')
    manifest = manifest or load_showcase_manifest()
    created = {section: 0 for section in _SECTIONS}
    existing = {section: 0 for section in _SECTIONS}
    masters = {section: {} for section in _SECTIONS[:-1]}
    models = {
        'sponsors': Sponsor,
        'brokers': Broker,
        'funds': Fund,
        'properties': Property,
    }
    for section, model in models.items():
        for row in manifest.sections[section]:
            instance, was_created = _get_or_create_master(model, section, row, manifest)
            masters[section][row['key']] = instance
            (created if was_created else existing)[section] += 1

    pipeline = {}
    for row in manifest.sections['deals']:
        deal, was_created = _get_or_create_deal(row, manifest, actor, masters)
        (created if was_created else existing)['deals'] += 1
        pipeline[deal.pipeline_status] = pipeline.get(deal.pipeline_status, 0) + 1
    return ShowcaseSeedResult(
        dataset_key=manifest.dataset_key,
        created=created,
        existing=existing,
        pipeline=dict(sorted(pipeline.items())),
    )
