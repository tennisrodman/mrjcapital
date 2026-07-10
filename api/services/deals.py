from datetime import date, datetime

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from api.models import (
    ActivityActionType,
    ActivityLog,
    Deal,
    DealStageEvent,
    PipelineStatus,
    SyndicationStatus,
)


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
    SyndicationStatus.RAISING: {SyndicationStatus.FULLY_SUBSCRIBED},
    SyndicationStatus.FULLY_SUBSCRIBED: {SyndicationStatus.CLOSED},
    SyndicationStatus.CLOSED: set(),
}

SYNDICATION_START_PIPELINE_STATUSES = {
    PipelineStatus.QUOTING,
    PipelineStatus.NEGOTIATING,
    PipelineStatus.SIGNED,
    PipelineStatus.CLOSING,
}
SYNDICATION_TERMINAL_PIPELINE_STATUSES = {PipelineStatus.DEAD, PipelineStatus.EXITED}

# `details` is deliberately absent: it is flexible JSON and may contain data
# that should never be copied into the immutable audit log. Pipeline and
# syndication statuses are handled only by their explicit transition services.
DEAL_FIELD_AUDIT_FIELDS = frozenset({
    'name',
    'investment_type',
    'source_channel',
    'source_date',
    'requested_amount',
    'sponsor',
    'broker',
    'fund',
})


def allowed_pipeline_statuses(deal):
    if deal.pipeline_status == PipelineStatus.ON_HOLD and deal.paused_from_status:
        return [deal.paused_from_status, PipelineStatus.DEAD]
    return sorted(PIPELINE_TRANSITIONS.get(deal.pipeline_status, set()))


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
            performed_by=_authenticated_actor(performed_by),
        )


def capture_deal_field_values(deal, candidate_fields):
    """Capture only allowlisted, non-sensitive values before a Deal edit."""
    return {
        field_name: _safe_deal_field_value(deal, field_name)
        for field_name in candidate_fields
        if field_name in DEAL_FIELD_AUDIT_FIELDS
    }


def log_deal_field_updates(deal, previous_values, performed_by, ip_address=None):
    """Write immutable audit entries for safe business-field changes only."""
    actor = _authenticated_actor(performed_by)
    logs = []
    for field_name, old_value in previous_values.items():
        new_value = _safe_deal_field_value(deal, field_name)
        if old_value == new_value:
            continue
        logs.append(ActivityLog(
            deal=deal,
            action_type=ActivityActionType.FIELD_UPDATED,
            performed_by=actor,
            ip_address=ip_address,
            description=f'{field_name} updated',
            old_value=old_value,
            new_value=new_value,
            metadata={
                'field': field_name,
                'subject_model': 'Deal',
                'subject_id': str(deal.pk),
            },
        ))
    if logs:
        ActivityLog.objects.bulk_create(logs)
    return logs


def transition_pipeline_status(deal, to_status, performed_by, reason, ip_address=None):
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

        transition_at = timezone.now()
        locked_deal.pipeline_status = to_status
        locked_deal.current_stage_entered_at = transition_at
        locked_deal.save(update_fields=[
            'pipeline_status',
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
        performed_by=_authenticated_actor(performed_by),
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
        performed_by=_authenticated_actor(performed_by),
        reason=reason,
    )


def _safe_deal_field_value(deal, field_name):
    if field_name in {'sponsor', 'broker', 'fund'}:
        value = getattr(deal, f'{field_name}_id')
    else:
        value = getattr(deal, field_name)
    if value is None:
        return ''
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return str(value)


def _authenticated_actor(performed_by):
    return performed_by if getattr(performed_by, 'is_authenticated', False) else None


def _require_reason(reason):
    if not reason or not str(reason).strip():
        raise ValidationError({'reason': 'A reason is required for every status transition.'})


def _validate_choice(value, choices, field_name):
    if value not in choices:
        raise ValidationError({field_name: f'Unsupported value: {value}.'})
