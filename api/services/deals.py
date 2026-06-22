from django.core.exceptions import ValidationError
from django.db import transaction

from api.models import ActivityActionType, ActivityLog, Deal, PipelineStatus, SyndicationStatus


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


def transition_pipeline_status(deal, to_status, performed_by, reason, ip_address=None):
    _require_reason(reason)
    _validate_choice(to_status, PipelineStatus.values, 'to_status')

    with transaction.atomic():
        locked_deal = Deal.objects.select_for_update().get(pk=deal.pk)
        from_status = locked_deal.pipeline_status
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

        locked_deal.pipeline_status = to_status
        locked_deal.save(update_fields=['pipeline_status', 'paused_from_status', 'updated_at'])
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
        performed_by=performed_by if getattr(performed_by, 'is_authenticated', False) else None,
        ip_address=ip_address,
        description=f'{metadata["field"]} changed from {old_value} to {new_value}',
        old_value=old_value,
        new_value=new_value,
        reason=reason,
        metadata=metadata,
    )


def _require_reason(reason):
    if not reason or not str(reason).strip():
        raise ValidationError({'reason': 'A reason is required for every status transition.'})


def _validate_choice(value, choices, field_name):
    if value not in choices:
        raise ValidationError({field_name: f'Unsupported value: {value}.'})
