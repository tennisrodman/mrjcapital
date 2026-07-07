from django.db import transaction

from api.models import ActivityActionType, ActivityLog, DealNote

NOTE_EXCERPT_LENGTH = 80


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
            author=author if getattr(author, 'is_authenticated', False) else None,
            body=body,
            visibility_roles=visibility_roles or ['internal'],
        )
        if attachments:
            note.attachments.set(attachments)
        log_note_added(note, author, ip_address)
    return note


def log_note_added(note, performed_by, ip_address):
    excerpt = note.body.strip()
    if len(excerpt) > NOTE_EXCERPT_LENGTH:
        excerpt = excerpt[:NOTE_EXCERPT_LENGTH].rstrip() + '…'
    return ActivityLog.objects.create(
        deal=note.deal,
        action_type=ActivityActionType.NOTE_ADDED,
        performed_by=performed_by if getattr(performed_by, 'is_authenticated', False) else None,
        ip_address=ip_address,
        description=f'Note added: {excerpt}',
        metadata={
            'subject_model': 'deal_note',
            'subject_id': str(note.id),
            'attachment_ids': [str(attachment.id) for attachment in note.attachments.all()],
        },
    )
