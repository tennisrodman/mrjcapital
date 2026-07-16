"""Development-only, service-driven deal lifecycle scenarios.

The versioned manifest supplies business inputs while this module creates
workflow evidence through the same services used by the application.
"""

from __future__ import annotations

import hashlib
import json
import re
import uuid
from copy import deepcopy
from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from api.models import (
    ActivityLog,
    Broker,
    DDChecklistItem,
    DDTemplate,
    Deal,
    Document,
    DocumentCategory,
    DocumentStorageStatus,
    Fund,
    PipelineStatus,
    Property,
    Quote,
    ScreeningAssessment,
    Sponsor,
    SUPPORTED_DEBT_INVESTMENT_TYPES,
    SyndicationStatus,
)
from api.models.closing import ConditionPrecedent
from api.services.address import normalize_address
from api.services.closing import (
    generate_closing_checklist,
    set_cp_documents,
    set_dd_documents,
    update_cp_item,
    update_dd_item,
    upsert_closing_package,
)
from api.services.deals import (
    PipelineReadinessError,
    initialize_deal_stage_event,
    transition_pipeline_status,
    transition_syndication_status,
)
from api.services.deal_properties import replace_deal_properties
from api.services.documents import (
    log_document_upload_completed,
    log_document_upload_started,
)
from api.services.quotes import (
    counter_quote,
    create_next_quote,
    execute_quote,
    send_quote,
    set_quote_attachments,
    update_draft_quote,
)
from api.services.screening import create_next_assessment, finalize_assessment
from api.services.storage import build_document_key, get_document_storage


SCENARIO_VERSION = 1
DEFAULT_MANIFEST_PATH = Path(__file__).resolve().parents[2] / 'shared' / 'workflow_seed.v1.json'
SEED_UUID_NAMESPACE = uuid.UUID('48f6ead4-81d6-4cd7-8d31-fbb64a0f2db2')
_KEY_PATTERN = re.compile(r'^[a-z0-9][a-z0-9_-]*$')
SUPPORTED_TARGETS = (
    PipelineStatus.SOURCED,
    PipelineStatus.SCREENING,
    PipelineStatus.QUOTING,
    PipelineStatus.NEGOTIATING,
    PipelineStatus.SIGNED,
    PipelineStatus.CLOSING,
    PipelineStatus.CLOSED,
    PipelineStatus.SERVICING,
    PipelineStatus.EXITED,
)

_PROTECTED_FIELDS = {
    'id',
    'pk',
    'pipeline_status',
    'syndication_status',
    'paused_from_status',
    'current_stage_entered_at',
    'storage_status',
    'is_executed',
    'is_current',
    'version',
    'finalized_at',
    'sent_at',
    'executed_at',
    'activity',
    'activity_rows',
    'stage_events',
    'checksum_sha256',
    'file_url',
}

_MASTER_FIELDS = {
    'sponsor': {
        'key', 'entity_name', 'entity_type', 'primary_contact_name',
        'primary_contact_email', 'primary_contact_phone', 'relationship_rating',
        'website', 'years_experience', 'completed_projects', 'bankruptcy_history',
        'business_address', 'total_units_owned', 'assets_under_management',
        'connection_source',
    },
    'broker': {
        'key', 'company_name', 'contact_name', 'email', 'phone', 'status',
        'default_commission_rate', 'commission_type', 'preferred_deal_types',
        'geographic_focus',
    },
    'fund': {'key', 'name', 'status'},
    'property': {
        'key', 'address', 'city', 'state', 'zip', 'property_type', 'subtype',
        'units', 'rentable_square_feet', 'year_built', 'year_renovated', 'county',
        'msa', 'number_of_buildings', 'number_of_stories', 'parking_spaces',
        'lot_size_acres', 'flood_zone', 'zoning_designation', 'environmental_status',
    },
}
_DEAL_FIELDS = {
    'sponsor_key', 'broker_key', 'fund_key', 'property_key', 'name_template',
    'investment_type', 'source_channel', 'source_date_days_ago', 'requested_amount',
    'purpose', 'profile', 'estimated_value', 'renovation_budget', 'description',
    'deposit_status', 'deposit_received_days_ago', 'deposit_account_label',
    'deposit_refund_conditions', 'exclusivity_granted', 'exclusivity_expiry_in_days',
}
_SCREENING_FIELDS = {
    'loan_amount', 'as_is_value', 'stabilized_value', 'project_cost', 'noi',
    'stabilized_noi', 'annual_debt_service', 'occupancy', 'proposed_rate',
    'proposed_term_months', 'current_average_rent', 'market_rent',
    'condition_rating', 'unit_mix', 'exit_strategy', 'exit_cap_rate', 'decision',
    'decision_notes',
}
_QUOTE_FIELDS = {
    'rate_type', 'interest_rate', 'amortization_type', 'recourse_type',
    'origination_fee_pct', 'good_faith_deposit', 'expires_in_days',
}
_EVIDENCE_FIELDS = {
    'key', 'filename', 'content_type', 'category', 'subcategory', 'body_template',
}
_CLOSING_FIELDS = {'template_key', 'initial_target_close_in_days', 'evidence', 'package'}
_CLOSING_PACKAGE_FIELDS = {
    'actual_close_days_ago', 'funds_wired_days_ago', 'funds_wired_amount',
    'closing_attorney', 'title_company', 'final_loan_amount', 'purchase_price',
    'appraised_value', 'closing_costs', 'sources_and_uses_notes',
}


@dataclass(frozen=True)
class WorkflowScenario:
    key: str
    target: str
    fingerprint: str


@dataclass(frozen=True)
class WorkflowManifest:
    schema_version: int
    dataset_key: str
    fingerprint: str
    masters: dict
    inputs: dict
    scenarios: tuple[WorkflowScenario, ...]
    path: Path


@dataclass(frozen=True)
class ScenarioResult:
    deal: Deal
    created: bool
    storage_keys: tuple[str, ...]


def _canonical_fingerprint(value):
    payload = json.dumps(
        value,
        sort_keys=True,
        separators=(',', ':'),
        ensure_ascii=False,
        default=str,
    )
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


def _seed_uuid(dataset_key, entity_type, entity_key):
    return uuid.uuid5(SEED_UUID_NAMESPACE, f'{dataset_key}:{entity_type}:{entity_key}')


def _validate_key(value, field):
    if not isinstance(value, str) or not _KEY_PATTERN.fullmatch(value):
        raise ValidationError({field: 'Use lowercase letters, numbers, hyphens, or underscores.'})


def _require_mapping(value, field):
    if not isinstance(value, dict):
        raise ValidationError({field: 'Expected an object.'})
    return value


def _reject_unknown(mapping, allowed, field):
    unknown = sorted(set(mapping) - allowed)
    if unknown:
        raise ValidationError({field: f'Unknown or protected fields: {", ".join(unknown)}.'})


def _require_keys(mapping, required, field):
    missing = sorted(required - set(mapping))
    if missing:
        raise ValidationError({field: f'Missing required fields: {", ".join(missing)}.'})


def _require_nonnegative_int(mapping, name, field):
    value = mapping.get(name)
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise ValidationError({f'{field}.{name}': 'Expected a non-negative integer.'})


def _validate_evidence_input(evidence, field, *, required_category=None):
    _reject_unknown(evidence, _EVIDENCE_FIELDS, field)
    _require_keys(evidence, _EVIDENCE_FIELDS, field)
    _validate_key(evidence.get('key'), f'{field}.key')
    filename = evidence.get('filename')
    if not isinstance(filename, str) or not filename or Path(filename).name != filename:
        raise ValidationError({f'{field}.filename': 'Use a plain filename without a directory.'})
    if required_category and evidence.get('category') != required_category:
        raise ValidationError({f'{field}.category': f'Expected category {required_category}.'})
    if not isinstance(evidence.get('content_type'), str) or not evidence['content_type']:
        raise ValidationError({f'{field}.content_type': 'A content type is required.'})
    if not isinstance(evidence.get('body_template'), str):
        raise ValidationError({f'{field}.body_template': 'Expected a string template.'})
    try:
        evidence.get('body_template', '').format(
            scenario_key='validation-scenario',
            deal_id='00000000-0000-0000-0000-000000000000',
        )
    except (KeyError, ValueError) as exc:
        raise ValidationError({
            f'{field}.body_template': 'Only valid scenario_key and deal_id placeholders are supported.',
        }) from exc


def _reject_protected_fields(value, path='manifest'):
    if isinstance(value, dict):
        for key, nested in value.items():
            if key in _PROTECTED_FIELDS:
                raise ValidationError({path: f'Protected loader-owned field is not allowed: {key}.'})
            _reject_protected_fields(nested, f'{path}.{key}')
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            _reject_protected_fields(nested, f'{path}[{index}]')


def load_workflow_manifest(path=None):
    """Load and strictly validate a versioned development workflow manifest."""
    manifest_path = Path(path or DEFAULT_MANIFEST_PATH).expanduser().resolve()
    try:
        raw = json.loads(manifest_path.read_text(encoding='utf-8'))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValidationError({'manifest': f'Unable to load workflow manifest: {exc}.'}) from exc
    _require_mapping(raw, 'manifest')
    _reject_unknown(raw, {'schema_version', 'dataset_key', 'masters', 'inputs', 'scenarios'}, 'manifest')
    _reject_protected_fields(raw)
    if raw.get('schema_version') != SCENARIO_VERSION:
        raise ValidationError({
            'schema_version': f'Expected workflow schema {SCENARIO_VERSION}; got {raw.get("schema_version")!r}.',
        })
    dataset_key = raw.get('dataset_key')
    _validate_key(dataset_key, 'dataset_key')

    masters = _require_mapping(raw.get('masters'), 'masters')
    _reject_unknown(masters, set(_MASTER_FIELDS), 'masters')
    if set(masters) != set(_MASTER_FIELDS):
        raise ValidationError({'masters': 'Sponsor, broker, fund, and property are required.'})
    master_keys = {}
    for kind, allowed in _MASTER_FIELDS.items():
        item = _require_mapping(masters[kind], f'masters.{kind}')
        _reject_unknown(item, allowed, f'masters.{kind}')
        _require_keys(item, allowed, f'masters.{kind}')
        _validate_key(item.get('key'), f'masters.{kind}.key')
        master_keys[kind] = item['key']

    inputs = _require_mapping(raw.get('inputs'), 'inputs')
    _reject_unknown(inputs, {'deal', 'screening', 'quote', 'evidence', 'closing'}, 'inputs')
    if set(inputs) != {'deal', 'screening', 'quote', 'evidence', 'closing'}:
        raise ValidationError({'inputs': 'Deal, screening, quote, evidence, and closing inputs are required.'})
    deal = _require_mapping(inputs['deal'], 'inputs.deal')
    _reject_unknown(deal, _DEAL_FIELDS, 'inputs.deal')
    _require_keys(deal, _DEAL_FIELDS, 'inputs.deal')
    for name in (
        'source_date_days_ago',
        'deposit_received_days_ago',
        'exclusivity_expiry_in_days',
    ):
        _require_nonnegative_int(deal, name, 'inputs.deal')
    try:
        deal.get('name_template', '').format(
            target='sourced',
            target_title='Sourced',
            scenario_key='validation-scenario',
        )
    except (AttributeError, KeyError, ValueError) as exc:
        raise ValidationError({'inputs.deal.name_template': 'Invalid deal name template.'}) from exc
    for kind in _MASTER_FIELDS:
        if deal.get(f'{kind}_key') != master_keys[kind]:
            raise ValidationError({f'inputs.deal.{kind}_key': f'Must reference masters.{kind}.key.'})
    if deal.get('investment_type') not in SUPPORTED_DEBT_INVESTMENT_TYPES:
        raise ValidationError({
            'inputs.deal.investment_type': (
                'Only whole-loan debt investments are available in the current release.'
            ),
        })
    screening = _require_mapping(inputs['screening'], 'inputs.screening')
    _reject_unknown(screening, _SCREENING_FIELDS, 'inputs.screening')
    _require_keys(screening, _SCREENING_FIELDS, 'inputs.screening')
    if screening.get('decision') != ScreeningAssessment.Decision.ADVANCE:
        raise ValidationError({'inputs.screening.decision': 'Lifecycle progression requires an advance decision.'})
    quote = _require_mapping(inputs['quote'], 'inputs.quote')
    _reject_unknown(quote, {'initial', 'counter'}, 'inputs.quote')
    _require_keys(quote, {'initial', 'counter'}, 'inputs.quote')
    for quote_kind in ('initial', 'counter'):
        quote_part = _require_mapping(quote.get(quote_kind), f'inputs.quote.{quote_kind}')
        _reject_unknown(quote_part, _QUOTE_FIELDS, f'inputs.quote.{quote_kind}')
    _require_keys(quote['initial'], _QUOTE_FIELDS, 'inputs.quote.initial')
    _require_keys(quote['counter'], {'interest_rate', 'expires_in_days'}, 'inputs.quote.counter')
    _require_nonnegative_int(quote['initial'], 'expires_in_days', 'inputs.quote.initial')
    _require_nonnegative_int(quote['counter'], 'expires_in_days', 'inputs.quote.counter')
    evidence = _require_mapping(inputs['evidence'], 'inputs.evidence')
    _validate_evidence_input(
        evidence,
        'inputs.evidence',
        required_category=DocumentCategory.LEGAL,
    )
    if evidence.get('subcategory') not in {'term_sheet', 'loi'}:
        raise ValidationError({'inputs.evidence.subcategory': 'Use term_sheet or loi.'})
    closing = _require_mapping(inputs['closing'], 'inputs.closing')
    _reject_unknown(closing, _CLOSING_FIELDS, 'inputs.closing')
    _require_keys(closing, _CLOSING_FIELDS, 'inputs.closing')
    closing_evidence = _require_mapping(closing.get('evidence'), 'inputs.closing.evidence')
    _validate_evidence_input(
        closing_evidence,
        'inputs.closing.evidence',
        required_category=DocumentCategory.CLOSING_DOCS,
    )
    if not closing_evidence.get('subcategory'):
        raise ValidationError({'inputs.closing.evidence.subcategory': 'Closing evidence requires a subcategory.'})
    package = _require_mapping(closing.get('package'), 'inputs.closing.package')
    _reject_unknown(package, _CLOSING_PACKAGE_FIELDS, 'inputs.closing.package')
    _require_keys(package, _CLOSING_PACKAGE_FIELDS, 'inputs.closing.package')
    _require_nonnegative_int(closing, 'initial_target_close_in_days', 'inputs.closing')
    _require_nonnegative_int(package, 'actual_close_days_ago', 'inputs.closing.package')
    _require_nonnegative_int(package, 'funds_wired_days_ago', 'inputs.closing.package')

    raw_scenarios = raw.get('scenarios')
    if not isinstance(raw_scenarios, list) or not raw_scenarios:
        raise ValidationError({'scenarios': 'At least one scenario is required.'})
    scenarios = []
    seen = set()
    for index, item in enumerate(raw_scenarios):
        item = _require_mapping(item, f'scenarios[{index}]')
        _reject_unknown(item, {'key', 'target'}, f'scenarios[{index}]')
        _require_keys(item, {'key', 'target'}, f'scenarios[{index}]')
        key = item.get('key')
        target = item.get('target')
        _validate_key(key, f'scenarios[{index}].key')
        if key in seen:
            raise ValidationError({'scenarios': f'Duplicate scenario key: {key}.'})
        if target not in SUPPORTED_TARGETS:
            raise ValidationError({f'scenarios[{index}].target': f'Unsupported target: {target}.'})
        seen.add(key)
        scenario_payload = {
            'schema_version': SCENARIO_VERSION,
            'dataset_key': dataset_key,
            'masters': masters,
            'inputs': inputs,
            'scenario': item,
        }
        scenarios.append(WorkflowScenario(key, target, _canonical_fingerprint(scenario_payload)))
    return WorkflowManifest(
        schema_version=SCENARIO_VERSION,
        dataset_key=dataset_key,
        fingerprint=_canonical_fingerprint(raw),
        masters=deepcopy(masters),
        inputs=deepcopy(inputs),
        scenarios=tuple(scenarios),
        path=manifest_path,
    )


def _require_actor(actor):
    if not getattr(actor, 'is_authenticated', False) or not getattr(actor, 'is_active', False):
        raise ValidationError({'actor': 'An active authenticated actor is required.'})
    if not getattr(actor, 'is_staff', False):
        raise ValidationError({'actor': 'Lifecycle scenarios require a staff actor.'})


def _validate_expected_fields(instance, expected, field):
    changed = sorted(name for name, value in expected.items() if getattr(instance, name) != value)
    if changed:
        raise ValidationError({field: f'Seeded data was modified after creation: {", ".join(changed)}.'})


def _validate_existing_business_state(existing, scenario, manifest, masters):
    sponsor, broker, fund, prop = masters
    deal_input = _decimal_fields(
        manifest.inputs['deal'],
        {'requested_amount', 'estimated_value', 'renovation_budget'},
    )
    seed_date = timezone.localdate(existing.created_at)
    _validate_expected_fields(
        existing,
        {
            'name': deal_input['name_template'].format(
                target=scenario.target,
                target_title=scenario.target.title(),
                scenario_key=scenario.key,
            ),
            'investment_type': deal_input['investment_type'],
            'sponsor_id': sponsor.pk,
            'broker_id': broker.pk,
            'fund_id': fund.pk,
            'source_channel': deal_input['source_channel'],
            'source_date': seed_date - timedelta(days=deal_input['source_date_days_ago']),
            'requested_amount': deal_input['requested_amount'],
            'purpose': deal_input['purpose'],
            'profile': deal_input['profile'],
            'estimated_value': deal_input['estimated_value'],
            'renovation_budget': deal_input['renovation_budget'],
            'description': deal_input['description'],
            'deposit_status': deal_input['deposit_status'],
            'deposit_received_date': seed_date - timedelta(days=deal_input['deposit_received_days_ago']),
            'deposit_account_label': deal_input['deposit_account_label'],
            'deposit_refund_conditions': deal_input['deposit_refund_conditions'],
            'exclusivity_granted': deal_input['exclusivity_granted'],
            'exclusivity_expiry_date': seed_date + timedelta(days=deal_input['exclusivity_expiry_in_days']),
        },
        'inputs.deal',
    )
    property_links = list(
        existing.deal_properties.order_by('property_id').values_list('property_id', 'is_primary')
    )
    if property_links != [(prop.pk, True)]:
        raise ValidationError({'inputs.deal.property_key': 'Seeded property relationship was modified.'})

    target_index = SUPPORTED_TARGETS.index(scenario.target)
    expected_stages = SUPPORTED_TARGETS[:target_index + 1]
    stage_events = list(existing.stage_events.order_by('entered_at', 'id'))
    actual_stages = tuple(event.to_status for event in stage_events)
    if actual_stages != expected_stages or sum(event.exited_at is None for event in stage_events) != 1:
        raise ValidationError({'scenario_key': 'Seeded pipeline stage history was modified.'})

    expected_syndication = SyndicationStatus.NOT_STARTED
    if target_index == 2:
        expected_syndication = SyndicationStatus.RAISING
    elif target_index == 3:
        expected_syndication = SyndicationStatus.FULLY_SUBSCRIBED
    elif target_index >= 4:
        expected_syndication = SyndicationStatus.CLOSED
    if existing.syndication_status != expected_syndication:
        raise ValidationError({'scenario_key': 'Seeded syndication state was modified.'})

    assessments = list(existing.screening_assessments.order_by('version'))
    expected_assessment_count = 0 if target_index == 0 else 1
    if len(assessments) != expected_assessment_count:
        raise ValidationError({'inputs.screening': 'Seeded screening version history was modified.'})
    if assessments:
        screening_input = _decimal_fields(
            manifest.inputs['screening'],
            {
                'loan_amount', 'as_is_value', 'stabilized_value', 'project_cost',
                'noi', 'stabilized_noi', 'annual_debt_service', 'occupancy',
                'proposed_rate', 'current_average_rent', 'market_rent', 'exit_cap_rate',
            },
        )
        assessment = assessments[0]
        expected_screening = {
            name: value
            for name, value in screening_input.items()
            if name not in {'decision', 'decision_notes'}
        }
        expected_screening.update({
            'version': 1,
            'status': (
                ScreeningAssessment.Status.DRAFT
                if target_index == 1
                else ScreeningAssessment.Status.FINALIZED
            ),
            'decision': '' if target_index == 1 else screening_input['decision'],
            'notes': '' if target_index == 1 else screening_input['decision_notes'],
        })
        _validate_expected_fields(assessment, expected_screening, 'inputs.screening')

    quotes = list(existing.quotes.order_by('version'))
    expected_quote_count = 0 if target_index < 2 else (1 if target_index == 2 else 2)
    if len(quotes) != expected_quote_count:
        raise ValidationError({'inputs.quote': 'Seeded quote version history was modified.'})
    if quotes:
        initial_input = _decimal_fields(
            manifest.inputs['quote']['initial'],
            {'interest_rate', 'origination_fee_pct', 'good_faith_deposit'},
        )
        initial_input.pop('expires_in_days')
        _validate_expected_fields(
            quotes[0],
            {
                **initial_input,
                'version': 1,
                'status': Quote.Status.SENT,
                'is_counter': False,
                'loan_amount': _decimal_fields(manifest.inputs['screening'], {'loan_amount'})['loan_amount'],
                'term_months': manifest.inputs['screening']['proposed_term_months'],
            },
            'inputs.quote.initial',
        )
    if len(quotes) == 2:
        counter_input = _decimal_fields(
            manifest.inputs['quote']['counter'],
            {'interest_rate', 'origination_fee_pct', 'good_faith_deposit'},
        )
        counter_input.pop('expires_in_days')
        _validate_expected_fields(
            quotes[1],
            {
                **initial_input,
                **counter_input,
                'version': 2,
                'status': Quote.Status.EXECUTED,
                'is_counter': True,
                'loan_amount': _decimal_fields(manifest.inputs['screening'], {'loan_amount'})['loan_amount'],
                'term_months': manifest.inputs['screening']['proposed_term_months'],
            },
            'inputs.quote.counter',
        )

    expected_document_kinds = []
    if target_index >= 3:
        expected_document_kinds.append('quote_execution')
    if target_index >= 6:
        expected_document_kinds.append('closing')
    actual_document_kinds = sorted(existing.documents.values_list('details__evidence_kind', flat=True))
    if actual_document_kinds != sorted(expected_document_kinds):
        raise ValidationError({'inputs.evidence': 'Seeded document evidence set was modified.'})

    package = getattr(existing, 'closing_package', None)
    if target_index < 5:
        if package is not None:
            raise ValidationError({'inputs.closing': 'Unexpected seeded closing package exists.'})
        return
    if package is None:
        raise ValidationError({'inputs.closing': 'Seeded closing package is missing.'})
    generations = list(package.generations.order_by('version'))
    if len(generations) != 1 or generations[0].template_key != manifest.inputs['closing']['template_key']:
        raise ValidationError({'inputs.closing': 'Seeded closing checklist generation was modified.'})
    if target_index >= 6:
        closing_input = manifest.inputs['closing']
        package_input = _decimal_fields(
            closing_input['package'],
            {
                'funds_wired_amount', 'final_loan_amount', 'purchase_price',
                'appraised_value', 'closing_costs',
            },
        )
        actual_days = package_input.pop('actual_close_days_ago')
        wired_days = package_input.pop('funds_wired_days_ago')
        _validate_expected_fields(
            package,
            {
                **package_input,
                'target_close_date': seed_date + timedelta(days=closing_input['initial_target_close_in_days']),
                'actual_close_date': seed_date - timedelta(days=actual_days),
                'funds_wired_date': seed_date - timedelta(days=wired_days),
            },
            'inputs.closing.package',
        )


def _validate_existing_scenario(existing, scenario, manifest, masters):
    if existing.pk != _seed_uuid(manifest.dataset_key, 'scenario', scenario.key):
        raise ValidationError({'scenario_key': 'Existing scenario does not use the deterministic seed identity.'})
    if existing.details.get('scenario_version') != manifest.schema_version:
        raise ValidationError({'scenario_key': 'Existing scenario uses a different version.'})
    if existing.details.get('seed_dataset') != manifest.dataset_key:
        raise ValidationError({'scenario_key': 'Existing scenario belongs to a different seed dataset.'})
    if existing.details.get('scenario_fingerprint') != scenario.fingerprint:
        raise ValidationError({'scenario_key': 'Scenario inputs changed without a new scenario key or schema version.'})
    if existing.details.get('target_status') != scenario.target or existing.pipeline_status != scenario.target:
        raise ValidationError({'scenario_key': 'Existing scenario has a different target status.'})
    _validate_existing_business_state(existing, scenario, manifest, masters)
    storage = get_document_storage()
    for key in existing.details.get('storage_keys', []):
        document = existing.documents.filter(
            file_url=key,
            storage_status=DocumentStorageStatus.READY,
        ).first()
        if document is None:
            raise ValidationError({'scenario_key': 'Existing scenario evidence metadata is inconsistent.'})
        meta = storage.inspect_object(key, document.file_size_bytes)
        if (
            meta is None
            or meta.size != document.file_size_bytes
            or meta.checksum_sha256.lower() != document.checksum_sha256.lower()
        ):
            raise ValidationError({'scenario_key': 'Existing scenario evidence blob is missing or corrupt.'})
    if scenario.target in {
        PipelineStatus.CLOSED,
        PipelineStatus.SERVICING,
        PipelineStatus.EXITED,
    }:
        package = getattr(existing, 'closing_package', None)
        generation = package.generations.filter(is_current=True).first() if package else None
        closing_document = existing.documents.filter(details__evidence_kind='closing').first()
        if generation is None or closing_document is None:
            raise ValidationError({'scenario_key': 'Existing closing evidence is incomplete.'})
        if (
            generation.dd_items.exclude(documents=closing_document).exists()
            or generation.conditions_precedent.exclude(documents=closing_document).exists()
        ):
            raise ValidationError({'scenario_key': 'Closing evidence is not linked to every terminal item.'})


def _expect_blocker(deal, target, blocker, actor):
    try:
        transition_pipeline_status(
            deal,
            target,
            actor,
            f'Scenario verifies {blocker}',
        )
    except PipelineReadinessError as exc:
        if blocker not in exc.readiness['blockers']:
            raise AssertionError(
                f'Expected {blocker} before {target}; got {exc.readiness["blockers"]}.'
            ) from exc
        return
    raise AssertionError(f'Transition to {target} unexpectedly bypassed {blocker}.')


def _decimal_fields(values, names):
    converted = dict(values)
    for name in names:
        if name in converted and converted[name] is not None:
            try:
                converted[name] = Decimal(str(converted[name]))
            except Exception as exc:
                raise ValidationError({name: 'Expected a decimal-compatible value.'}) from exc
    return converted


def _seed_marker(manifest, kind, key, payload):
    return {
        'development_scenario': True,
        'seed_dataset': manifest.dataset_key,
        'seed_entity': kind,
        'seed_key': key,
        'seed_schema_version': manifest.schema_version,
        'seed_fingerprint': _canonical_fingerprint(payload),
    }


def _get_or_create_seed_master(model, manifest, kind, payload, *, extra=None):
    key = payload['key']
    object_id = _seed_uuid(manifest.dataset_key, kind, key)
    marker = _seed_marker(manifest, kind, key, payload)
    existing = model.objects.filter(pk=object_id).first()
    if existing:
        details = existing.details or {}
        if any(details.get(name) != value for name, value in marker.items()):
            raise ValidationError({f'masters.{kind}': 'Deterministic seed identity is occupied by different data.'})
        expected = {
            **{name: value for name, value in payload.items() if name != 'key'},
            **(extra or {}),
        }
        if any(getattr(existing, name) != value for name, value in expected.items()):
            raise ValidationError({f'masters.{kind}': 'Tagged seed master data was modified after creation.'})
        return existing
    fields = {name: value for name, value in payload.items() if name != 'key'}
    fields.update(extra or {})
    fields['details'] = marker
    instance = model(pk=object_id, **fields)
    instance.full_clean()
    instance.save(force_insert=True)
    return instance


def _scenario_master_data(manifest):
    sponsor_payload = _decimal_fields(
        manifest.masters['sponsor'],
        {'assets_under_management'},
    )
    broker_payload = _decimal_fields(
        manifest.masters['broker'],
        {'default_commission_rate'},
    )
    property_payload = _decimal_fields(
        manifest.masters['property'],
        {'lot_size_acres'},
    )
    normalized = normalize_address(
        property_payload['address'],
        property_payload['city'],
        property_payload['state'],
        property_payload['zip'],
    )
    property_id = _seed_uuid(manifest.dataset_key, 'property', property_payload['key'])
    address_owner = Property.objects.filter(address_normalized=normalized).exclude(pk=property_id).first()
    if address_owner:
        raise ValidationError({
            'masters.property': 'Canonical property address is already owned by a different record.',
        })
    sponsor = _get_or_create_seed_master(Sponsor, manifest, 'sponsor', sponsor_payload)
    broker = _get_or_create_seed_master(Broker, manifest, 'broker', broker_payload)
    fund = _get_or_create_seed_master(Fund, manifest, 'fund', manifest.masters['fund'])
    prop = _get_or_create_seed_master(
        Property,
        manifest,
        'property',
        property_payload,
        extra={'address_normalized': normalized},
    )
    return sponsor, broker, fund, prop


def _create_ready_document(deal, actor, scenario, manifest, evidence, evidence_kind):
    body = evidence['body_template'].format(
        scenario_key=scenario.key,
        deal_id=deal.pk,
    ).encode('utf-8')
    document_id = _seed_uuid(
        manifest.dataset_key,
        'document',
        f'{scenario.key}:{evidence_kind}:{evidence["key"]}',
    )
    filename = evidence['filename']
    key = build_document_key(deal.pk, document_id, 1, filename)
    checksum = hashlib.sha256(body).hexdigest()
    storage = get_document_storage()
    try:
        document = Document.objects.create(
            pk=document_id,
            deal=deal,
            document_name=filename,
            category=evidence['category'],
            subcategory=evidence['subcategory'],
            file_url=key,
            file_type='txt',
            content_type=evidence['content_type'],
            file_size_bytes=len(body),
            checksum_sha256=checksum,
            storage_status=DocumentStorageStatus.PENDING,
            pipeline_stage_at_upload=deal.pipeline_status,
            uploaded_by=actor,
            visibility_roles=['internal'],
            details={
                'development_scenario': True,
                'seed_dataset': manifest.dataset_key,
                'scenario_key': scenario.key,
                'evidence_kind': evidence_kind,
                'evidence_key': evidence['key'],
            },
        )
        log_document_upload_started(document, performed_by=actor)
        meta = storage.write_object(key, body, evidence['content_type'])
        if meta.size != len(body) or meta.checksum_sha256 != checksum:
            raise AssertionError('Scenario storage did not preserve size and checksum.')
        document.storage_status = DocumentStorageStatus.READY
        document.save(update_fields=['storage_status'])
        log_document_upload_completed(document, performed_by=actor)
        return document, key
    except Exception:
        storage.delete_object(key)
        raise


@transaction.atomic
def build_lifecycle_scenario(
    *,
    actor,
    scenario_key,
    target_status=PipelineStatus.EXITED,
    assert_gates=True,
    manifest=None,
):
    """Create one coherent scenario, stopping at ``target_status``.

    Existing keys are returned unchanged, making durable development seeding
    idempotent without deleting immutable audit evidence.
    """
    _require_actor(actor)
    manifest = manifest or load_workflow_manifest()
    if not settings.DEBUG:
        raise ValidationError({'settings': 'Lifecycle scenarios require DEBUG=True.'})
    if getattr(settings, 'DOCUMENT_STORAGE_BACKEND', 'local') != 'local':
        raise ValidationError({'settings': 'Lifecycle scenarios require local document storage.'})
    if target_status not in SUPPORTED_TARGETS:
        raise ValidationError({'target_status': f'Unsupported scenario target: {target_status}.'})
    configured = next((item for item in manifest.scenarios if item.key == scenario_key), None)
    if configured:
        if configured.target != target_status:
            raise ValidationError({'target_status': 'Target does not match the manifest scenario.'})
        scenario = configured
    else:
        scenario_payload = {
            'schema_version': manifest.schema_version,
            'dataset_key': manifest.dataset_key,
            'masters': manifest.masters,
            'inputs': manifest.inputs,
            'scenario': {'key': scenario_key, 'target': target_status},
        }
        _validate_key(scenario_key, 'scenario_key')
        scenario = WorkflowScenario(
            scenario_key,
            target_status,
            _canonical_fingerprint(scenario_payload),
        )
    deal_id = _seed_uuid(manifest.dataset_key, 'scenario', scenario.key)
    existing = Deal.objects.select_for_update().filter(pk=deal_id).first()
    tagged_existing = Deal.objects.filter(
        details__seed_dataset=manifest.dataset_key,
        details__scenario_key=scenario.key,
    ).exclude(pk=deal_id).first()
    if tagged_existing:
        raise ValidationError({'scenario_key': 'Scenario key is already associated with a different identity.'})
    masters = _scenario_master_data(manifest)
    if existing:
        _validate_existing_scenario(existing, scenario, manifest, masters)
        return ScenarioResult(existing, False, tuple(existing.details.get('storage_keys', [])))

    storage_keys = []
    try:
        sponsor, broker, fund, prop = masters
        deal_input = _decimal_fields(
            manifest.inputs['deal'],
            {'requested_amount', 'estimated_value', 'renovation_budget'},
        )
        today = timezone.localdate()
        deal = Deal(
            pk=deal_id,
            name=deal_input['name_template'].format(
                target=scenario.target,
                target_title=scenario.target.title(),
                scenario_key=scenario.key,
            ),
            investment_type=deal_input['investment_type'],
            sponsor=sponsor,
            broker=broker,
            assigned_analyst=actor,
            fund=fund,
            source_channel=deal_input['source_channel'],
            source_date=today - timedelta(days=deal_input['source_date_days_ago']),
            requested_amount=deal_input['requested_amount'],
            purpose=deal_input['purpose'],
            profile=deal_input['profile'],
            estimated_value=deal_input['estimated_value'],
            renovation_budget=deal_input['renovation_budget'],
            description=deal_input['description'],
            deposit_status=deal_input['deposit_status'],
            deposit_received_date=today - timedelta(days=deal_input['deposit_received_days_ago']),
            deposit_account_label=deal_input['deposit_account_label'],
            deposit_refund_conditions=deal_input['deposit_refund_conditions'],
            exclusivity_granted=deal_input['exclusivity_granted'],
            exclusivity_expiry_date=today + timedelta(days=deal_input['exclusivity_expiry_in_days']),
            details={
                'development_scenario': True,
                'seed_dataset': manifest.dataset_key,
                'scenario_key': scenario.key,
                'scenario_version': manifest.schema_version,
                'scenario_fingerprint': scenario.fingerprint,
                'manifest_fingerprint': manifest.fingerprint,
                'target_status': scenario.target,
            },
        )
        deal.full_clean()
        deal.save(force_insert=True)
        replace_deal_properties(deal, [prop], performed_by=actor)
        initialize_deal_stage_event(deal, actor)
        if scenario.target == PipelineStatus.SOURCED:
            return ScenarioResult(deal, True, ())

        deal = transition_pipeline_status(deal, PipelineStatus.SCREENING, actor, 'Begin underwriting screening')
        screening_input = _decimal_fields(
            manifest.inputs['screening'],
            {
                'loan_amount', 'as_is_value', 'stabilized_value', 'project_cost',
                'noi', 'stabilized_noi', 'annual_debt_service', 'occupancy',
                'proposed_rate', 'current_average_rent', 'market_rent', 'exit_cap_rate',
            },
        )
        assessment = create_next_assessment(
            deal=deal,
            performed_by=actor,
            **{
                key: value
                for key, value in screening_input.items()
                if key not in {'decision', 'decision_notes'}
            },
        )
        if scenario.target == PipelineStatus.SCREENING:
            return ScenarioResult(deal, True, ())
        if assert_gates:
            _expect_blocker(deal, PipelineStatus.QUOTING, 'screening_assessment_not_finalized', actor)
        finalize_assessment(
            assessment=assessment,
            reviewer=actor,
            decision=screening_input['decision'],
            notes=screening_input['decision_notes'],
        )
        deal = transition_pipeline_status(deal, PipelineStatus.QUOTING, actor, 'Screening approved')

        quote = create_next_quote(deal=deal, created_by=actor)
        initial_quote_input = _decimal_fields(
            manifest.inputs['quote']['initial'],
            {'interest_rate', 'origination_fee_pct', 'good_faith_deposit'},
        )
        initial_expiry_days = initial_quote_input.pop('expires_in_days')
        quote = update_draft_quote(
            quote,
            performed_by=actor,
            **initial_quote_input,
            expires_at=timezone.now() + timedelta(days=initial_expiry_days),
        )
        quote = send_quote(quote, performed_by=actor)
        deal = transition_syndication_status(deal, SyndicationStatus.RAISING, actor, 'Begin scenario syndication')
        if scenario.target == PipelineStatus.QUOTING:
            return ScenarioResult(deal, True, ())

        deal = transition_pipeline_status(deal, PipelineStatus.NEGOTIATING, actor, 'Sent terms accepted for negotiation')
        deal = transition_syndication_status(
            deal,
            SyndicationStatus.FULLY_SUBSCRIBED,
            actor,
            'Scenario allocation fully subscribed',
        )
        counter = counter_quote(quote=quote, created_by=actor)
        counter_quote_input = _decimal_fields(
            manifest.inputs['quote']['counter'],
            {'interest_rate', 'origination_fee_pct', 'good_faith_deposit'},
        )
        counter_expiry_days = counter_quote_input.pop('expires_in_days')
        counter = update_draft_quote(
            counter,
            performed_by=actor,
            **counter_quote_input,
            expires_at=timezone.now() + timedelta(days=counter_expiry_days),
        )
        counter = send_quote(counter, performed_by=actor)
        if assert_gates:
            _expect_blocker(deal, PipelineStatus.SIGNED, 'quote_execution_required', actor)
            try:
                execute_quote(counter, performed_by=actor)
            except ValidationError as exc:
                if 'attachments' not in getattr(exc, 'message_dict', {}):
                    raise AssertionError('Missing execution evidence produced the wrong validation error.') from exc
            else:
                raise AssertionError('A quote executed without legal evidence.')
        document, storage_key = _create_ready_document(
            deal,
            actor,
            scenario,
            manifest,
            manifest.inputs['evidence'],
            'quote_execution',
        )
        storage_keys.append(storage_key)
        deal.details = {**deal.details, 'storage_keys': storage_keys}
        deal.save(update_fields=['details', 'updated_at'])
        set_quote_attachments(counter, [document.pk], user=actor)
        execute_quote(counter, performed_by=actor)
        if scenario.target == PipelineStatus.NEGOTIATING:
            return ScenarioResult(deal, True, tuple(storage_keys))

        deal = transition_pipeline_status(deal, PipelineStatus.SIGNED, actor, 'Countered term sheet executed')
        deal = transition_syndication_status(
            deal,
            SyndicationStatus.CLOSED,
            actor,
            'Scenario syndication commitments closed',
        )
        if scenario.target == PipelineStatus.SIGNED:
            return ScenarioResult(deal, True, tuple(storage_keys))

        deal = transition_pipeline_status(deal, PipelineStatus.CLOSING, actor, 'Begin legal closing and final diligence')
        closing_input = manifest.inputs['closing']
        template = DDTemplate.objects.get(key=closing_input['template_key'])
        generation = generate_closing_checklist(
            deal,
            template,
            performed_by=actor,
            initial_target_close_date=today + timedelta(days=closing_input['initial_target_close_in_days']),
        )
        if scenario.target == PipelineStatus.CLOSING:
            return ScenarioResult(deal, True, tuple(storage_keys))
        if assert_gates:
            _expect_blocker(deal, PipelineStatus.CLOSED, 'closing_funding_details_incomplete', actor)

        closing_package = _decimal_fields(
            closing_input['package'],
            {
                'funds_wired_amount', 'final_loan_amount', 'purchase_price',
                'appraised_value', 'closing_costs',
            },
        )
        actual_close_days_ago = closing_package.pop('actual_close_days_ago')
        funds_wired_days_ago = closing_package.pop('funds_wired_days_ago')
        upsert_closing_package(
            deal,
            performed_by=actor,
            fields_present={*closing_package, 'actual_close_date', 'funds_wired_date'},
            actual_close_date=today - timedelta(days=actual_close_days_ago),
            funds_wired_date=today - timedelta(days=funds_wired_days_ago),
            **closing_package,
        )
        closing_document, closing_storage_key = _create_ready_document(
            deal,
            actor,
            scenario,
            manifest,
            closing_input['evidence'],
            'closing',
        )
        storage_keys.append(closing_storage_key)
        deal.details = {**deal.details, 'storage_keys': storage_keys}
        deal.save(update_fields=['details', 'updated_at'])
        for item in generation.dd_items.all():
            set_dd_documents(
                item,
                [closing_document.pk],
                performed_by=actor,
                user=actor,
            )
            update_dd_item(item, performed_by=actor, status=DDChecklistItem.Status.COMPLETE)
        for item in generation.conditions_precedent.all():
            set_cp_documents(
                item,
                [closing_document.pk],
                performed_by=actor,
                user=actor,
            )
            update_cp_item(item, performed_by=actor, status=ConditionPrecedent.Status.SATISFIED)
        deal = transition_pipeline_status(deal, PipelineStatus.CLOSED, actor, 'Funding confirmed and checklist cleared')
        if scenario.target == PipelineStatus.CLOSED:
            return ScenarioResult(deal, True, tuple(storage_keys))
        deal = transition_pipeline_status(deal, PipelineStatus.SERVICING, actor, 'Board loan for servicing')
        if scenario.target == PipelineStatus.SERVICING:
            return ScenarioResult(deal, True, tuple(storage_keys))
        deal = transition_pipeline_status(deal, PipelineStatus.EXITED, actor, 'Scenario loan repaid at maturity')
        deal.details = {**deal.details, 'storage_keys': storage_keys}
        deal.save(update_fields=['details', 'updated_at'])
        return ScenarioResult(deal, True, tuple(storage_keys))
    except Exception:
        storage = get_document_storage()
        for key in storage_keys:
            storage.delete_object(key)
        raise


def scenario_summary(result):
    deal = result.deal
    return {
        'created': result.created,
        'deal_id': str(deal.pk),
        'scenario_key': deal.details.get('scenario_key'),
        'pipeline_status': deal.pipeline_status,
        'screening_versions': deal.screening_assessments.count(),
        'quote_versions': deal.quotes.count(),
        'documents': deal.documents.count(),
        'stage_events': deal.stage_events.count(),
        'activity_rows': ActivityLog.objects.filter(deal=deal).count(),
    }
