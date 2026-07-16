"""Transaction-safe deal-contact relationship mutations and audit evidence."""

from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction

from api.models import ActivityActionType, Deal, DealContact
from api.services.audit import create_activity_log


def _validate_link_constraints(*, deal, contact, role, is_primary, exclude_id=None):
    duplicate = DealContact.objects.filter(deal=deal, contact=contact, role=role)
    primary = DealContact.objects.filter(deal=deal, role=role, is_primary=True)
    if exclude_id:
        duplicate = duplicate.exclude(pk=exclude_id)
        primary = primary.exclude(pk=exclude_id)
    if duplicate.exists():
        raise ValidationError({
            'non_field_errors': 'This contact already has that role on the deal.',
        })
    if is_primary and primary.exists():
        raise ValidationError({
            'is_primary': 'This deal already has a primary contact for that role.',
        })


def create_deal_contact(
    *,
    deal,
    contact,
    role,
    is_primary=False,
    notes='',
    performed_by=None,
):
    with transaction.atomic():
        locked_deal = Deal.objects.select_for_update().get(pk=deal.pk)
        _validate_link_constraints(
            deal=locked_deal,
            contact=contact,
            role=role,
            is_primary=is_primary,
        )
        try:
            with transaction.atomic():
                link = DealContact.objects.create(
                    deal=locked_deal,
                    contact=contact,
                    role=role,
                    is_primary=is_primary,
                    notes=notes,
                )
        except IntegrityError as exc:
            raise ValidationError({
                'detail': 'The contact link conflicts with an existing deal contact.',
            }) from exc
        create_activity_log(
            deal=locked_deal,
            action_type=ActivityActionType.DEAL_CONTACT_ADDED,
            performed_by=performed_by,
            description=f'Deal contact added: {contact.full_name} ({link.get_role_display()})',
            metadata={
                'deal_contact_id': str(link.pk),
                'contact_id': str(contact.pk),
                'role': role,
                'is_primary': is_primary,
            },
        )
        return link


def update_deal_contact(link, *, performed_by=None, **fields):
    allowed_fields = {'is_primary', 'notes'}
    invalid = sorted(set(fields) - allowed_fields)
    if invalid:
        raise ValidationError({field: 'This field cannot be changed.' for field in invalid})
    with transaction.atomic():
        locked_deal = Deal.objects.select_for_update().get(pk=link.deal_id)
        locked = DealContact.objects.select_for_update().select_related('contact').get(pk=link.pk)
        changed = sorted(
            field for field, value in fields.items() if getattr(locked, field) != value
        )
        if not changed:
            return locked
        candidate_primary = fields.get('is_primary', locked.is_primary)
        _validate_link_constraints(
            deal=locked_deal,
            contact=locked.contact,
            role=locked.role,
            is_primary=candidate_primary,
            exclude_id=locked.pk,
        )
        for field in changed:
            setattr(locked, field, fields[field])
        try:
            with transaction.atomic():
                locked.save(update_fields=[*changed, 'updated_at'])
        except IntegrityError as exc:
            raise ValidationError({
                'detail': 'The contact link conflicts with an existing deal contact.',
            }) from exc
        create_activity_log(
            deal=locked_deal,
            action_type=ActivityActionType.DEAL_CONTACT_UPDATED,
            performed_by=performed_by,
            description=f'Deal contact updated: {locked.contact.full_name} ({locked.get_role_display()})',
            metadata={
                'deal_contact_id': str(locked.pk),
                'contact_id': str(locked.contact_id),
                'role': locked.role,
                'fields': changed,
                'is_primary': locked.is_primary,
            },
        )
        return locked


def delete_deal_contact(link, *, performed_by=None):
    with transaction.atomic():
        locked_deal = Deal.objects.select_for_update().get(pk=link.deal_id)
        locked = DealContact.objects.select_for_update().select_related('contact').get(pk=link.pk)
        metadata = {
            'deal_contact_id': str(locked.pk),
            'contact_id': str(locked.contact_id),
            'role': locked.role,
            'is_primary': locked.is_primary,
        }
        description = f'Deal contact deleted: {locked.contact.full_name} ({locked.get_role_display()})'
        locked.delete()
        create_activity_log(
            deal=locked_deal,
            action_type=ActivityActionType.DEAL_CONTACT_DELETED,
            performed_by=performed_by,
            description=description,
            metadata=metadata,
        )
