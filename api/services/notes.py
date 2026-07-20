from django.db import transaction

from api.models import ActivityActionType, DealNote, DocumentStorageStatus
from api.policies import authenticated_user, is_staff_user
from api.services.audit import create_activity_log

NOTE_EXCERPT_LENGTH = 80


def _attachment_visible_to_user(document, user):
    return is_staff_user(user) or 'internal' in (document.visibility_roles or [])


def _validate_requested_attachments(attachments, *, deal_id, user):
    unavailable = [
        str(doc.id)
        for doc in attachments
        if (
            doc.deal_id != deal_id
            or doc.storage_status != DocumentStorageStatus.READY
            or not _attachment_visible_to_user(doc, user)
        )
    ]
    if unavailable:
        raise ValueError('One or more note attachments are not available.')


def can_manage_note(note, user) -> bool:
    return is_staff_user(user) or (
        authenticated_user(user) is not None and note.author_id == user.id
    )


def create_note(*, deal, author, body, attachments=None, visibility_roles=None, ip_address=None):
    # The API path validates same-deal attachments in DealNoteSerializer, but
    # this service is exported: guard the data-integrity invariant here too so
    # no internal caller can link a document from another deal by accident.
    attachments = list(attachments or [])
    if attachments:
        _validate_requested_attachments(attachments, deal_id=deal.id, user=author)
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
            _validate_requested_attachments(
                attachments,
                deal_id=locked.deal_id,
                user=performed_by,
            )
            existing = list(locked.attachments.all())
            hidden_existing = [
                doc for doc in existing if not _attachment_visible_to_user(doc, performed_by)
            ]
            final_attachments = {doc.pk: doc for doc in [*attachments, *hidden_existing]}
            before_ids = {doc.pk for doc in existing}
            after_ids = set(final_attachments)
            if before_ids != after_ids:
                locked.attachments.set(final_attachments.values())
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
