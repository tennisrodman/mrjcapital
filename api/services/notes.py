from django.db import transaction

from api.models import ActivityActionType, DealNote
from api.policies import authenticated_user, is_staff_user
from api.services.audit import create_activity_log

NOTE_EXCERPT_LENGTH = 80


def can_manage_note(note, user) -> bool:
    return is_staff_user(user) or (
        authenticated_user(user) is not None and note.author_id == user.id
    )


def create_note(*, deal, author, body, attachments=None, visibility_roles=None, ip_address=None):
    # The API path validates same-deal attachments in DealNoteSerializer, but
    # this service is exported: guard the data-integrity invariant here too so
    # no internal caller can link a document from another deal by accident.
    if attachments:
        mismatched = [str(doc.id) for doc in attachments if doc.deal_id != deal.id]
        if mismatched:
            raise ValueError(
                f'Cannot attach documents from a different deal: {", ".join(mismatched)}'
            )
    with transaction.atomic():
        note = DealNote.objects.create(
            deal=deal,
            author=authenticated_user(author),
            body=body,
            visibility_roles=visibility_roles or ['internal'],
        )
        if attachments:
            note.attachments.set(attachments)
        log_note_added(note, author, ip_address)
    return note


def update_note(
    note,
    *,
    performed_by,
    body=None,
    attachments=None,
    attachments_provided=False,
    ip_address=None,
):
    with transaction.atomic():
        locked = DealNote.objects.select_for_update().select_related('deal').get(pk=note.pk)
        changed_fields = []
        if body is not None and body != locked.body:
            locked.body = body
            changed_fields.append('body')

        if attachments_provided:
            attachments = list(attachments or [])
            mismatched = [str(doc.id) for doc in attachments if doc.deal_id != locked.deal_id]
            if mismatched:
                raise ValueError(
                    f'Cannot attach documents from a different deal: {", ".join(mismatched)}'
                )
            before_ids = set(locked.attachments.values_list('pk', flat=True))
            after_ids = {doc.pk for doc in attachments}
            if before_ids != after_ids:
                locked.attachments.set(attachments)
                changed_fields.append('attachments')

        if changed_fields:
            update_fields = ['updated_at']
            if 'body' in changed_fields:
                update_fields.append('body')
            locked.save(update_fields=update_fields)
            log_note_updated(locked, performed_by, ip_address, changed_fields)
    return locked


def delete_note(note, *, performed_by, ip_address=None):
    with transaction.atomic():
        locked = DealNote.objects.select_for_update().select_related('deal').get(pk=note.pk)
        log_note_deleted(locked, performed_by, ip_address)
        locked.delete()


def _note_excerpt(note):
    excerpt = note.body.strip()
    if len(excerpt) > NOTE_EXCERPT_LENGTH:
        excerpt = excerpt[:NOTE_EXCERPT_LENGTH].rstrip() + '…'
    return excerpt


def _note_metadata(note):
    return {
        'subject_model': 'deal_note',
        'subject_id': str(note.id),
        'attachment_ids': [str(attachment.id) for attachment in note.attachments.all()],
    }


def log_note_added(note, performed_by, ip_address):
    return create_activity_log(
        deal=note.deal,
        action_type=ActivityActionType.NOTE_ADDED,
        performed_by=performed_by,
        ip_address=ip_address,
        description=f'Note added: {_note_excerpt(note)}',
        metadata=_note_metadata(note),
    )


def log_note_updated(note, performed_by, ip_address, changed_fields):
    metadata = _note_metadata(note)
    metadata['changed_fields'] = sorted(changed_fields)
    return create_activity_log(
        deal=note.deal,
        action_type=ActivityActionType.NOTE_UPDATED,
        performed_by=performed_by,
        ip_address=ip_address,
        description=f'Note updated: {_note_excerpt(note)}',
        metadata=metadata,
    )


def log_note_deleted(note, performed_by, ip_address):
    return create_activity_log(
        deal=note.deal,
        action_type=ActivityActionType.NOTE_DELETED,
        performed_by=performed_by,
        ip_address=ip_address,
        description=f'Note deleted: {_note_excerpt(note)}',
        metadata=_note_metadata(note),
    )
