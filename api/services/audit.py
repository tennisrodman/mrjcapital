from django.core.exceptions import ValidationError

from api.models import ActivityActionType, ActivityLog
from api.policies import authenticated_user


SENSITIVE_SPONSOR_FIELDS = {
    'ein',
    'guarantor_net_worth',
    'guarantor_liquidity',
    'guarantor_credit_score',
}


def create_activity_log(
    *,
    deal,
    action_type,
    performed_by=None,
    description,
    ip_address=None,
    old_value='',
    new_value='',
    reason='',
    metadata=None,
):
    """Write an activity event with a guaranteed human-readable timeline entry."""
    cleaned_description = str(description or '').strip()
    if not cleaned_description:
        raise ValueError('Activity log description is required.')
    return ActivityLog.objects.create(
        deal=deal,
        action_type=action_type,
        performed_by=authenticated_user(performed_by),
        ip_address=ip_address,
        description=cleaned_description,
        old_value=old_value or '',
        new_value=new_value or '',
        reason=reason or '',
        metadata=metadata or {},
    )


def log_sensitive_field_read(sponsor, fields, performed_by, reason, deal=None, ip_address=None):
    if not reason or not str(reason).strip():
        raise ValidationError({'reason': 'A reason is required to read sensitive fields.'})
    if not fields:
        raise ValidationError({'fields': 'At least one sensitive field is required.'})

    invalid_fields = sorted(set(fields) - SENSITIVE_SPONSOR_FIELDS)
    if invalid_fields:
        raise ValidationError({'fields': f'Unsupported sensitive field(s): {", ".join(invalid_fields)}'})

    values = {field: getattr(sponsor, field) for field in fields}
    create_activity_log(
        deal=deal,
        action_type=ActivityActionType.SENSITIVE_FIELD_READ,
        performed_by=performed_by if getattr(performed_by, 'is_authenticated', False) else None,
        ip_address=ip_address,
        description=f'Sensitive Sponsor fields read for {sponsor.entity_name}',
        reason=reason,
        metadata={
            'subject_model': 'Sponsor',
            'subject_id': str(sponsor.pk),
            'fields': list(fields),
        },
    )
    return values
