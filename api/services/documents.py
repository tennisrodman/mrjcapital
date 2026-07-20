"""Document policies, audit events, and durable blob deletion workflows."""

from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from api.models import ActivityActionType, DocumentBlobDeletion, Quote
from api.policies import authenticated_user, is_staff_user
from api.services.audit import create_activity_log


CLOSING_LINKED_DELETE_REASON = (
    'Document is linked to a closing checklist item and cannot be deleted.'
)
EXECUTED_QUOTE_DELETE_REASON = (
    'Document is attached to an executed quote and cannot be deleted.'
)
EXECUTED_DOCUMENT_DELETE_REASON = 'Only staff may delete executed documents.'
EXECUTED_METADATA_EDIT_REASON = 'Executed document metadata cannot be changed.'

LOCKED_METADATA_FIELDS = frozenset({'subcategory', 'expiry_date', 'notes', 'details'})


def _document_activity_metadata(document) -> dict[str, object]:
    return {
        'document_id': str(document.pk),
        'category': document.category,
        'version': document.version,
        'file_size_bytes': document.file_size_bytes,
        'storage_key': document.file_url,
    }


def log_document_upload_started(document, *, performed_by=None, ip_address=None):
    """Record creation of a pending upload before any blob transfer occurs."""
    return create_activity_log(
        deal=document.deal,
        action_type=ActivityActionType.DOCUMENT_UPLOAD_STARTED,
        performed_by=performed_by,
        ip_address=ip_address,
        description=f'Document upload started: {document.document_name} v{document.version}',
        metadata=_document_activity_metadata(document),
    )


def log_document_upload_completed(document, *, performed_by=None, ip_address=None):
    """Record the point at which a verified upload becomes visible and usable."""
    return create_activity_log(
        deal=document.deal,
        action_type=ActivityActionType.DOCUMENT_UPLOAD,
        performed_by=performed_by,
        ip_address=ip_address,
        description=f'Document uploaded: {document.document_name} v{document.version}',
        metadata=_document_activity_metadata(document),
    )


def log_document_upload_abandoned(document):
    """Record system cleanup of an upload that never reached completion."""
    metadata = _document_activity_metadata(document)
    metadata['uploaded_by_id'] = document.uploaded_by_id
    return create_activity_log(
        deal=document.deal,
        action_type=ActivityActionType.DOCUMENT_UPLOAD_ABANDONED,
        description=f'Pending document upload expired: {document.document_name} v{document.version}',
        reason='Upload did not complete before the pending-upload retention deadline.',
        metadata=metadata,
    )


def enqueue_document_blob_deletion(
    document,
    *,
    reason,
    requested_by=None,
    ip_address=None,
):
    """Persist deletion work and truthful pending evidence before removing the row."""
    next_attempt_at = timezone.now()
    # An R2 upload target remains usable until its signed PUT expires.  Deleting
    # the key before then would let that already-issued URL recreate the blob
    # after the database row and deletion work have disappeared.
    if getattr(settings, 'DOCUMENT_STORAGE_BACKEND', 'local') == 'r2':
        upload_expiry = int(getattr(settings, 'R2_PRESIGN_UPLOAD_EXPIRY', 3600))
        safety_skew = int(getattr(settings, 'R2_PRESIGN_DELETE_SAFETY_SKEW', 60))
        signed_put_safe_at = document.uploaded_date + timedelta(
            seconds=upload_expiry + safety_skew,
        )
        next_attempt_at = max(next_attempt_at, signed_put_safe_at)
    deletion = DocumentBlobDeletion.objects.create(
        deal=document.deal,
        document_id=document.pk,
        document_name=document.document_name,
        storage_key=document.file_url,
        reason=reason,
        requested_by=authenticated_user(requested_by),
        requested_ip=ip_address,
        next_attempt_at=next_attempt_at,
    )
    metadata = _document_activity_metadata(document)
    metadata.update({
        'blob_deletion_id': str(deletion.pk),
        'deletion_reason': reason,
    })
    create_activity_log(
        deal=document.deal,
        action_type=ActivityActionType.DOCUMENT_DELETE_PENDING,
        performed_by=requested_by,
        ip_address=ip_address,
        description=f'Document deletion pending: {document.document_name} v{document.version}',
        reason=deletion.get_reason_display(),
        metadata=metadata,
    )
    return deletion


def process_pending_blob_deletions(*, limit=100, storage=None):
    """Delete queued blobs idempotently, retaining failures with bounded backoff."""
    from api.services.storage import get_document_storage

    storage = storage or get_document_storage()
    now = timezone.now()
    deletion_ids = list(
        DocumentBlobDeletion.objects.filter(
            status=DocumentBlobDeletion.Status.PENDING,
            next_attempt_at__lte=now,
        ).order_by('next_attempt_at', 'requested_at').values_list('pk', flat=True)[:limit]
    )
    completed = 0
    failed = 0
    for deletion_id in deletion_ids:
        with transaction.atomic():
            deletion = (
                DocumentBlobDeletion.objects.select_for_update()
                .select_related('deal', 'requested_by')
                .filter(pk=deletion_id)
                .first()
            )
            if (
                not deletion
                or deletion.status != DocumentBlobDeletion.Status.PENDING
                or deletion.next_attempt_at > timezone.now()
            ):
                continue

            deletion.attempt_count += 1
            deletion.last_attempt_at = timezone.now()
            try:
                storage.delete_object(deletion.storage_key)
            except Exception as exc:  # noqa: BLE001 — failure is durably retained for retry
                delay_seconds = min(3600, 60 * (2 ** min(deletion.attempt_count - 1, 6)))
                deletion.next_attempt_at = timezone.now() + timedelta(seconds=delay_seconds)
                deletion.last_error = str(exc)[:4000]
                deletion.save(update_fields=[
                    'attempt_count',
                    'last_attempt_at',
                    'next_attempt_at',
                    'last_error',
                ])
                failed += 1
                continue

            deletion.status = DocumentBlobDeletion.Status.COMPLETED
            deletion.completed_at = timezone.now()
            deletion.last_error = ''
            deletion.save(update_fields=[
                'status',
                'completed_at',
                'attempt_count',
                'last_attempt_at',
                'last_error',
            ])
            create_activity_log(
                deal=deletion.deal,
                action_type=ActivityActionType.DOCUMENT_DELETED,
                performed_by=deletion.requested_by,
                ip_address=deletion.requested_ip,
                description=f'Document deleted from storage: {deletion.document_name}',
                reason=deletion.get_reason_display(),
                metadata={
                    'document_id': str(deletion.document_id),
                    'blob_deletion_id': str(deletion.pk),
                    'storage_key': deletion.storage_key,
                    'attempt_count': deletion.attempt_count,
                },
            )
            completed += 1
    return {'completed': completed, 'failed': failed}


def _prefetched_related(document, relation_name):
    cache = getattr(document, '_prefetched_objects_cache', {})
    return cache.get(relation_name)


def document_is_closing_linked(document) -> bool:
    """Return whether closing evidence protects this document from deletion."""
    dd_items = _prefetched_related(document, 'dd_checklist_items')
    cp_items = _prefetched_related(document, 'condition_precedents')
    return (
        bool(dd_items) if dd_items is not None else document.dd_checklist_items.exists()
    ) or (
        bool(cp_items) if cp_items is not None else document.condition_precedents.exists()
    )


def document_is_executed_quote_evidence(document) -> bool:
    """Return whether an executed quote protects this document as evidence."""
    quotes = _prefetched_related(document, 'quotes')
    if quotes is not None:
        return any(quote.status == Quote.Status.EXECUTED for quote in quotes)
    return document.quotes.filter(status=Quote.Status.EXECUTED).exists()


def document_action_capabilities(document, user) -> dict[str, object]:
    """Describe actions a caller can take and the reason for every blocked action."""
    closing_linked = document_is_closing_linked(document)
    executed_quote_evidence = document_is_executed_quote_evidence(document)
    metadata_locked = bool(document.is_executed or executed_quote_evidence)

    delete_reason = ''
    if closing_linked:
        delete_reason = CLOSING_LINKED_DELETE_REASON
    elif executed_quote_evidence:
        delete_reason = EXECUTED_QUOTE_DELETE_REASON
    elif document.is_executed and not is_staff_user(user):
        delete_reason = EXECUTED_DOCUMENT_DELETE_REASON

    return {
        'can_edit': not metadata_locked,
        'edit_block_reason': EXECUTED_METADATA_EDIT_REASON if metadata_locked else '',
        'can_delete': not delete_reason,
        'delete_block_reason': delete_reason,
    }


def locked_metadata_errors(document, attrs) -> dict[str, str]:
    """Return field errors for attempted changes to immutable execution evidence."""
    if not (document.is_executed or document_is_executed_quote_evidence(document)):
        return {}
    return {
        field_name: EXECUTED_METADATA_EDIT_REASON
        for field_name in LOCKED_METADATA_FIELDS
        if field_name in attrs and attrs[field_name] != getattr(document, field_name)
    }
