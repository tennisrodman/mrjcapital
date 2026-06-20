from django.core.exceptions import ValidationError

from api.models import ActivityActionType, ActivityLog


SENSITIVE_SPONSOR_FIELDS = {
    'ein',
    'guarantor_net_worth',
    'guarantor_liquidity',
    'guarantor_credit_score',
}


def log_sensitive_field_read(sponsor, fields, performed_by, reason, deal=None, ip_address=None):
    if not reason or not str(reason).strip():
        raise ValidationError({'reason': 'A reason is required to read sensitive fields.'})
    if not fields:
        raise ValidationError({'fields': 'At least one sensitive field is required.'})

    invalid_fields = sorted(set(fields) - SENSITIVE_SPONSOR_FIELDS)
    if invalid_fields:
        raise ValidationError({'fields': f'Unsupported sensitive field(s): {", ".join(invalid_fields)}'})

    values = {field: getattr(sponsor, field) for field in fields}
    ActivityLog.objects.create(
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
