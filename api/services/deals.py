from datetime import date, datetime

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from api.models import (
    ActivityActionType,
    ActivityLog,
    ClosingChecklistGeneration,
    ClosingPackage,
    ConditionPrecedent,
    DDChecklistItem,
    DDTemplateItem,
    Deal,
    DealStageEvent,
    PipelineStatus,
    Quote,
    ScreeningAssessment,
    SyndicationStatus,
)
from api.policies import authenticated_user, is_staff_user


PIPELINE_TRANSITIONS = {
    PipelineStatus.SOURCED: {PipelineStatus.SCREENING, PipelineStatus.ON_HOLD, PipelineStatus.DEAD},
    PipelineStatus.SCREENING: {PipelineStatus.QUOTING, PipelineStatus.ON_HOLD, PipelineStatus.DEAD},
    PipelineStatus.QUOTING: {PipelineStatus.NEGOTIATING, PipelineStatus.ON_HOLD, PipelineStatus.DEAD},
    PipelineStatus.NEGOTIATING: {
        PipelineStatus.SIGNED,
        PipelineStatus.QUOTING,
        PipelineStatus.ON_HOLD,
        PipelineStatus.DEAD,
    },
    PipelineStatus.SIGNED: {PipelineStatus.CLOSING, PipelineStatus.QUOTING, PipelineStatus.ON_HOLD, PipelineStatus.DEAD},
    PipelineStatus.CLOSING: {
        PipelineStatus.CLOSED,
        PipelineStatus.NEGOTIATING,
        PipelineStatus.QUOTING,
        PipelineStatus.ON_HOLD,
        PipelineStatus.DEAD,
    },
    PipelineStatus.CLOSED: {PipelineStatus.SERVICING},
    PipelineStatus.SERVICING: {PipelineStatus.EXITED},
    PipelineStatus.ON_HOLD: set(),
    PipelineStatus.DEAD: set(),
    PipelineStatus.EXITED: set(),
}

SYNDICATION_TRANSITIONS = {
    SyndicationStatus.NOT_STARTED: {SyndicationStatus.RAISING},
    SyndicationStatus.RAISING: {
        SyndicationStatus.FULLY_SUBSCRIBED,
        SyndicationStatus.CANCELLED,
    },
    SyndicationStatus.FULLY_SUBSCRIBED: {
        SyndicationStatus.CLOSED,
        SyndicationStatus.CANCELLED,
    },
    SyndicationStatus.CLOSED: set(),
    SyndicationStatus.CANCELLED: set(),
}

SYNDICATION_START_PIPELINE_STATUSES = {
    PipelineStatus.QUOTING,
    PipelineStatus.NEGOTIATING,
    PipelineStatus.SIGNED,
    PipelineStatus.CLOSING,
}
SYNDICATION_TERMINAL_PIPELINE_STATUSES = {PipelineStatus.DEAD, PipelineStatus.EXITED}
SYNDICATION_ACTIVE_STATUSES = {
    SyndicationStatus.RAISING,
    SyndicationStatus.FULLY_SUBSCRIBED,
}
ACTIVE_PIPELINE_EXCLUDED_STATUSES = frozenset({
    PipelineStatus.CLOSED,
    PipelineStatus.SERVICING,
    PipelineStatus.DEAD,
    PipelineStatus.EXITED,
})

# `details` is deliberately absent: it is flexible JSON and may contain data
# that should never be copied into the immutable audit log. Pipeline and
# syndication statuses are handled only by their explicit transition services.
DEAL_FIELD_AUDIT_FIELDS = frozenset({
    'name',
    'investment_type',
    'source_channel',
    'source_date',
    'requested_amount',
    'purpose',
    'profile',
    'estimated_value',
    'renovation_budget',
    'description',
    'assigned_analyst',
    'deposit_status',
    'deposit_received_date',
    'deposit_account_label',
    'deposit_refund_conditions',
    'exclusivity_granted',
    'exclusivity_expiry_date',
    'key_negotiation_changes',
    'sponsor',
    'broker',
    'fund',
})

READINESS_READY = 'ready'
SCREENING_APPROVAL_REQUIRED = 'screening_approval_required'
SCREENING_ASSESSMENT_MISSING = 'screening_assessment_missing'
SCREENING_ASSESSMENT_NOT_FINALIZED = 'screening_assessment_not_finalized'
SCREENING_ASSESSMENT_INCOMPLETE = 'screening_assessment_incomplete'
SCREENING_DECISION_NOT_ADVANCE = 'screening_decision_not_advance'
QUOTE_READINESS_REQUIRED = 'quote_readiness_required'
QUOTE_REQUIRED_FOR_NEGOTIATING = 'quote_required_for_negotiating'
QUOTE_EXECUTION_REQUIRED = 'quote_execution_required'
QUOTE_EXECUTION_EVIDENCE_REQUIRED = 'quote_execution_evidence_required'
CLOSING_READINESS_REQUIRED = 'closing_readiness_required'
CLOSING_PACKAGE_REQUIRED = 'closing_package_required'
CLOSING_FUNDING_DETAILS_INCOMPLETE = 'closing_funding_details_incomplete'
CLOSING_CHECKLIST_REQUIRED = 'closing_checklist_required'
CLOSING_DD_INCOMPLETE = 'closing_dd_incomplete'
CLOSING_CP_INCOMPLETE = 'closing_cp_incomplete'
SYNDICATION_RESOLUTION_REQUIRED = 'syndication_resolution_required'

_QUOTE_ACTIVE_FOR_NEGOTIATING = frozenset({
    Quote.Status.SENT,
    Quote.Status.COUNTERED,
    Quote.Status.EXECUTED,
})
_QUOTE_BLOCKERS = frozenset({
    QUOTE_REQUIRED_FOR_NEGOTIATING,
    QUOTE_EXECUTION_REQUIRED,
    QUOTE_EXECUTION_EVIDENCE_REQUIRED,
})
_CLOSING_BLOCKERS = frozenset({
    CLOSING_PACKAGE_REQUIRED,
    CLOSING_FUNDING_DETAILS_INCOMPLETE,
    CLOSING_CHECKLIST_REQUIRED,
    CLOSING_DD_INCOMPLETE,
    CLOSING_CP_INCOMPLETE,
})


class PipelineReadinessError(ValidationError):
    """A blocked transition carrying the public readiness response contract."""

    def __init__(self, readiness):
        self.readiness = readiness
        super().__init__({
            'to_status': 'This pipeline transition is blocked by readiness requirements.',
        })


def allowed_pipeline_statuses(deal):
    if deal.pipeline_status == PipelineStatus.ON_HOLD and deal.paused_from_status:
        return [deal.paused_from_status, PipelineStatus.DEAD]
    return sorted(PIPELINE_TRANSITIONS.get(deal.pipeline_status, set()))


def pipeline_transition_readiness(deal, to_status, performed_by=None):
    """Describe whether a legal pipeline target is ready to enter."""
    blockers = []
    if deal.pipeline_status == PipelineStatus.SCREENING and to_status == PipelineStatus.QUOTING:
        assessment = (
            ScreeningAssessment.objects.filter(deal=deal)
            .order_by('-version')
            .first()
        )
        if assessment is None:
            blockers.append(SCREENING_ASSESSMENT_MISSING)
        elif assessment.status != ScreeningAssessment.Status.FINALIZED:
            blockers.append(SCREENING_ASSESSMENT_NOT_FINALIZED)
        elif assessment.decision != ScreeningAssessment.Decision.ADVANCE:
            blockers.append(SCREENING_DECISION_NOT_ADVANCE)
        else:
            from api.services.screening import screening_is_complete
            if not screening_is_complete(assessment):
                blockers.append(SCREENING_ASSESSMENT_INCOMPLETE)

    if deal.pipeline_status == PipelineStatus.QUOTING and to_status == PipelineStatus.NEGOTIATING:
        quote = Quote.objects.filter(deal=deal).order_by('-version').first()
        from api.services.quotes import quote_is_effectively_expired
        if (
            quote is None
            or quote.status not in _QUOTE_ACTIVE_FOR_NEGOTIATING
            or quote_is_effectively_expired(quote)
        ):
            blockers.append(QUOTE_REQUIRED_FOR_NEGOTIATING)

    if deal.pipeline_status == PipelineStatus.NEGOTIATING and to_status == PipelineStatus.SIGNED:
        quote = Quote.objects.filter(deal=deal).order_by('-version').first()
        if quote is None or quote.status != Quote.Status.EXECUTED:
            blockers.append(QUOTE_EXECUTION_REQUIRED)
        else:
            from api.services.quotes import quote_has_execution_evidence
            if not quote_has_execution_evidence(quote):
                blockers.append(QUOTE_EXECUTION_EVIDENCE_REQUIRED)

    if deal.pipeline_status == PipelineStatus.CLOSING and to_status == PipelineStatus.CLOSED:
        package = ClosingPackage.objects.filter(deal=deal).first()
        if package is None:
            blockers.append(CLOSING_PACKAGE_REQUIRED)
        else:
            required_funding_fields = (
                'actual_close_date',
                'funds_wired_date',
                'funds_wired_amount',
                'closing_attorney',
                'title_company',
                'final_loan_amount',
            )
            funding_details_incomplete = any(
                getattr(package, field, None) in (None, '')
                for field in required_funding_fields
            )
            today = timezone.localdate()
            funding_details_incomplete = funding_details_incomplete or any(
                getattr(package, field, None) is not None
                and getattr(package, field) > today
                for field in ('actual_close_date', 'funds_wired_date')
            )
            if funding_details_incomplete:
                blockers.append(CLOSING_FUNDING_DETAILS_INCOMPLETE)
            generation = ClosingChecklistGeneration.objects.filter(
                package=package,
                is_current=True,
            ).first()
            if generation is None:
                blockers.append(CLOSING_CHECKLIST_REQUIRED)
            else:
                expected_dd_ids = set(DDTemplateItem.objects.filter(
                    template_id=generation.template_id,
                    kind=DDTemplateItem.Kind.DD,
                ).values_list('pk', flat=True)) if generation.template_id else set()
                present_dd_ids = set(generation.dd_items.filter(
                    source_template_item_id__in=expected_dd_ids,
                ).values_list('source_template_item_id', flat=True))
                dd_incomplete = bool(expected_dd_ids - present_dd_ids) or generation.dd_items.exclude(
                    status__in=[DDChecklistItem.Status.COMPLETE, DDChecklistItem.Status.WAIVED],
                ).exists()
                if dd_incomplete:
                    blockers.append(CLOSING_DD_INCOMPLETE)

                expected_cp_ids = set(DDTemplateItem.objects.filter(
                    template_id=generation.template_id,
                    kind=DDTemplateItem.Kind.CP,
                ).values_list('pk', flat=True)) if generation.template_id else set()
                present_cp_ids = set(generation.conditions_precedent.filter(
                    source_template_item_id__in=expected_cp_ids,
                ).values_list('source_template_item_id', flat=True))
                cp_incomplete = bool(expected_cp_ids - present_cp_ids) or generation.conditions_precedent.exclude(
                    status__in=[ConditionPrecedent.Status.SATISFIED, ConditionPrecedent.Status.WAIVED],
                ).exists()
                if cp_incomplete:
                    blockers.append(CLOSING_CP_INCOMPLETE)

    if to_status == PipelineStatus.EXITED and deal.syndication_status in SYNDICATION_ACTIVE_STATUSES:
        blockers.append(SYNDICATION_RESOLUTION_REQUIRED)

    ready = not blockers
    if ready:
        code = READINESS_READY
    elif any(blocker in _QUOTE_BLOCKERS for blocker in blockers):
        code = QUOTE_READINESS_REQUIRED
    elif any(blocker in _CLOSING_BLOCKERS for blocker in blockers):
        code = CLOSING_READINESS_REQUIRED
    elif SYNDICATION_RESOLUTION_REQUIRED in blockers:
        code = SYNDICATION_RESOLUTION_REQUIRED
    else:
        code = SCREENING_APPROVAL_REQUIRED

    return {
        'ready': ready,
        'code': code,
        'blockers': blockers,
        'can_override': bool(
            blockers
            and SYNDICATION_RESOLUTION_REQUIRED not in blockers
            and _can_override_readiness(performed_by)
        ),
    }


def allowed_pipeline_transition_readiness(deal, performed_by=None):
    """Return readiness for every target allowed by the pipeline state machine."""
    return {
        to_status: pipeline_transition_readiness(deal, to_status, performed_by)
        for to_status in allowed_pipeline_statuses(deal)
    }


def allowed_syndication_statuses(deal):
    allowed = SYNDICATION_TRANSITIONS.get(deal.syndication_status, set())
    if (
        deal.syndication_status == SyndicationStatus.NOT_STARTED
        and deal.pipeline_status not in SYNDICATION_START_PIPELINE_STATUSES
    ):
        return []
    if (
        deal.syndication_status != SyndicationStatus.NOT_STARTED
        and deal.pipeline_status in SYNDICATION_TERMINAL_PIPELINE_STATUSES
    ):
        return []
    return sorted(allowed)


def initialize_deal_stage_event(deal, performed_by=None):
    """Ensure a newly-created deal has one open pipeline-stage event.

    This is an explicit service instead of model-save behavior so that normal
    writes cannot silently create history outside the workflow boundary.
    """
    with transaction.atomic():
        locked_deal = Deal.objects.select_for_update().get(pk=deal.pk)
        open_event = (
            DealStageEvent.objects.select_for_update()
            .filter(deal=locked_deal, exited_at__isnull=True)
            .order_by('-entered_at', '-id')
            .first()
        )
        if open_event:
            return open_event
        return DealStageEvent.objects.create(
            deal=locked_deal,
            from_status=None,
            to_status=locked_deal.pipeline_status,
            entered_at=locked_deal.current_stage_entered_at or locked_deal.created_at or timezone.now(),
            performed_by=authenticated_user(performed_by),
        )


def capture_deal_field_values(deal, candidate_fields):
    """Capture full canonical values for reliable change detection.

    Audit persistence still applies field-specific excerpting below. Keeping
    the full value only in memory prevents long descriptions that differ after
    the excerpt boundary from silently avoiding an audit entry.
    """
    return {
        field_name: _canonical_deal_field_value(deal, field_name)
        for field_name in candidate_fields
        if field_name in DEAL_FIELD_AUDIT_FIELDS
    }


def log_deal_field_updates(deal, previous_values, performed_by, ip_address=None):
    """Write immutable audit entries for safe business-field changes only."""
    actor = authenticated_user(performed_by)
    logs = []
    for field_name, old_value in previous_values.items():
        new_value = _canonical_deal_field_value(deal, field_name)
        if old_value == new_value:
            continue
        logs.append(ActivityLog(
            deal=deal,
            action_type=ActivityActionType.FIELD_UPDATED,
            performed_by=actor,
            ip_address=ip_address,
            description=f'{field_name} updated',
            old_value=_audit_deal_field_value(field_name, old_value),
            new_value=_audit_deal_field_value(field_name, new_value),
            metadata={
                'field': field_name,
                'subject_model': 'Deal',
                'subject_id': str(deal.pk),
            },
        ))
    if logs:
        ActivityLog.objects.bulk_create(logs)
    return logs


def transition_pipeline_status(
    deal,
    to_status,
    performed_by,
    reason,
    ip_address=None,
    override_readiness=False,
):
    _require_reason(reason)
    _validate_choice(to_status, PipelineStatus.values, 'to_status')

    with transaction.atomic():
        locked_deal = Deal.objects.select_for_update().get(pk=deal.pk)
        from_status = locked_deal.pipeline_status
        previous_stage_entered_at = locked_deal.current_stage_entered_at
        if to_status == from_status:
            raise ValidationError({'to_status': 'Deal is already in that pipeline status.'})

        metadata = {'field': 'pipeline_status', 'from': from_status, 'to': to_status}
        if from_status == PipelineStatus.ON_HOLD:
            if not locked_deal.paused_from_status:
                raise ValidationError({'paused_from_status': 'Cannot resume; paused_from_status is missing.'})
            if to_status == PipelineStatus.DEAD:
                metadata['paused_from_status'] = locked_deal.paused_from_status
                locked_deal.paused_from_status = None
            elif to_status != locked_deal.paused_from_status:
                raise ValidationError({
                    'to_status': f'On-hold deals can only resume to {locked_deal.paused_from_status} or move to dead.',
                })
            else:
                metadata['paused_from_status'] = locked_deal.paused_from_status
                locked_deal.paused_from_status = None
        else:
            allowed = PIPELINE_TRANSITIONS.get(from_status, set())
            if to_status not in allowed:
                raise ValidationError({'to_status': f'Cannot transition pipeline status from {from_status} to {to_status}.'})
            if to_status == PipelineStatus.ON_HOLD:
                locked_deal.paused_from_status = from_status
                metadata['paused_from_status'] = from_status

        if override_readiness and not _can_override_readiness(performed_by):
            raise ValidationError({
                'override_readiness': 'Only staff may override pipeline readiness requirements.',
            })

        readiness = pipeline_transition_readiness(locked_deal, to_status, performed_by)
        if not readiness['ready'] and override_readiness and not readiness['can_override']:
            raise PipelineReadinessError(readiness)
        is_override = bool(not readiness['ready'] and override_readiness)
        if not readiness['ready'] and not is_override:
            raise PipelineReadinessError(readiness)

        metadata.update({
            'is_override': is_override,
            'readiness_code': readiness['code'],
            'readiness_blockers': readiness['blockers'],
        })

        transition_at = timezone.now()
        syndication_from_status = None
        if (
            to_status == PipelineStatus.DEAD
            and locked_deal.syndication_status in SYNDICATION_ACTIVE_STATUSES
        ):
            syndication_from_status = locked_deal.syndication_status
            locked_deal.syndication_status = SyndicationStatus.CANCELLED
        locked_deal.pipeline_status = to_status
        locked_deal.current_stage_entered_at = transition_at
        locked_deal.save(update_fields=[
            'pipeline_status',
            'syndication_status',
            'paused_from_status',
            'current_stage_entered_at',
            'updated_at',
        ])
        _record_pipeline_stage_transition(
            locked_deal,
            from_status=from_status,
            to_status=to_status,
            performed_by=performed_by,
            reason=reason,
            entered_at=transition_at,
            previous_entered_at=previous_stage_entered_at,
            is_override=is_override,
        )
        _write_status_log(
            locked_deal,
            performed_by,
            ip_address,
            reason,
            old_value=from_status,
            new_value=to_status,
            metadata=metadata,
        )
        if syndication_from_status is not None:
            _write_status_log(
                locked_deal,
                performed_by,
                ip_address,
                reason,
                old_value=syndication_from_status,
                new_value=SyndicationStatus.CANCELLED,
                metadata={
                    'field': 'syndication_status',
                    'from': syndication_from_status,
                    'to': SyndicationStatus.CANCELLED,
                    'automatic': True,
                    'trigger_pipeline_status': PipelineStatus.DEAD,
                },
            )
        return locked_deal


def transition_syndication_status(deal, to_status, performed_by, reason, ip_address=None):
    _require_reason(reason)
    _validate_choice(to_status, SyndicationStatus.values, 'to_status')

    with transaction.atomic():
        locked_deal = Deal.objects.select_for_update().get(pk=deal.pk)
        from_status = locked_deal.syndication_status
        if to_status == from_status:
            raise ValidationError({'to_status': 'Deal is already in that syndication status.'})
        if to_status not in SYNDICATION_TRANSITIONS.get(from_status, set()):
            raise ValidationError({
                'to_status': f'Cannot transition syndication status from {from_status} to {to_status}.',
            })
        if (
            from_status == SyndicationStatus.NOT_STARTED
            and to_status == SyndicationStatus.RAISING
            and locked_deal.pipeline_status not in SYNDICATION_START_PIPELINE_STATUSES
        ):
            raise ValidationError({
                'pipeline_status': 'Syndication can start only while the deal is quoting through closing.',
            })
        if (
            from_status != SyndicationStatus.NOT_STARTED
            and locked_deal.pipeline_status in SYNDICATION_TERMINAL_PIPELINE_STATUSES
        ):
            raise ValidationError({
                'pipeline_status': 'Syndication cannot advance after the deal is dead or exited.',
            })

        locked_deal.syndication_status = to_status
        locked_deal.save(update_fields=['syndication_status', 'updated_at'])
        _write_status_log(
            locked_deal,
            performed_by,
            ip_address,
            reason,
            old_value=from_status,
            new_value=to_status,
            metadata={'field': 'syndication_status', 'from': from_status, 'to': to_status},
        )
        return locked_deal


def _write_status_log(deal, performed_by, ip_address, reason, old_value, new_value, metadata):
    return ActivityLog.objects.create(
        deal=deal,
        action_type=ActivityActionType.STATUS_CHANGE,
        performed_by=authenticated_user(performed_by),
        ip_address=ip_address,
        description=f'{metadata["field"]} changed from {old_value} to {new_value}',
        old_value=old_value,
        new_value=new_value,
        reason=reason,
        metadata=metadata,
    )


def _record_pipeline_stage_transition(
    deal,
    *,
    from_status,
    to_status,
    performed_by,
    reason,
    entered_at,
    previous_entered_at,
    is_override=False,
):
    """Close the prior pipeline tenure and open the next one under the deal lock."""
    open_event = (
        DealStageEvent.objects.select_for_update()
        .filter(deal=deal, exited_at__isnull=True)
        .order_by('-entered_at', '-id')
        .first()
    )
    if open_event:
        open_event.exited_at = entered_at
        open_event.save(update_fields=['exited_at'])
    else:
        # Deals created after this migration are seeded through the create
        # service. This fallback keeps direct/internal callers historically
        # complete without putting implicit workflow logic in Deal.save().
        initial_entered_at = previous_entered_at or deal.created_at or entered_at
        if initial_entered_at > entered_at:
            initial_entered_at = entered_at
        DealStageEvent.objects.create(
            deal=deal,
            from_status=None,
            to_status=from_status,
            entered_at=initial_entered_at,
            exited_at=entered_at,
        )

    return DealStageEvent.objects.create(
        deal=deal,
        from_status=from_status,
        to_status=to_status,
        entered_at=entered_at,
        performed_by=authenticated_user(performed_by),
        reason=reason,
        is_override=is_override,
    )


def _canonical_deal_field_value(deal, field_name):
    if field_name in {'sponsor', 'broker', 'fund', 'assigned_analyst'}:
        value = getattr(deal, f'{field_name}_id')
    else:
        value = getattr(deal, field_name)
    if value is None:
        return ''
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return str(value)


def _audit_deal_field_value(field_name, value):
    if field_name == 'description' and len(value) > 500:
        return f'{value[:497]}...'
    return value


def _can_override_readiness(performed_by):
    return is_staff_user(performed_by)


def _require_reason(reason):
    if not reason or not str(reason).strip():
        raise ValidationError({'reason': 'A reason is required for every status transition.'})


def _validate_choice(value, choices, field_name):
    if value not in choices:
        raise ValidationError({field_name: f'Unsupported value: {value}.'})
