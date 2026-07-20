from celery import shared_task
from django.utils import timezone


@shared_task
def heartbeat():
    """Periodic sanity-check task wired in CELERY_BEAT_SCHEDULE."""
    return 'ok'


@shared_task
def cleanup_stale_pending_documents():
    """Remove abandoned upload rows and durably enqueue their blob deletion."""
    from datetime import timedelta
    import logging

    from django.conf import settings
    from django.db import transaction

    from api.models import Deal, Document, DocumentBlobDeletion, DocumentStorageStatus
    from api.services.documents import enqueue_document_blob_deletion, log_document_upload_abandoned

    logger = logging.getLogger(__name__)
    cutoff = timezone.now() - timedelta(hours=getattr(settings, 'DOCUMENT_PENDING_MAX_AGE_HOURS', 24))
    stale_ids = list(
        Document.objects.filter(
            storage_status=DocumentStorageStatus.PENDING,
            uploaded_date__lt=cutoff,
        ).values_list('pk', flat=True)
    )
    deleted = 0
    for document_id in stale_ids:
        try:
            with transaction.atomic():
                document = Document.objects.filter(pk=document_id).first()
                if not document:
                    continue
                # Deal-first lock order matches document complete/destroy.
                Deal.objects.select_for_update().filter(pk=document.deal_id).first()
                locked = Document.objects.select_for_update().filter(pk=document.pk).first()
                if not locked or locked.storage_status != DocumentStorageStatus.PENDING:
                    continue
                if locked.uploaded_date >= cutoff:
                    continue
                log_document_upload_abandoned(locked)
                enqueue_document_blob_deletion(
                    locked,
                    reason=DocumentBlobDeletion.Reason.STALE_UPLOAD,
                )
                locked.delete()
            deleted += 1
        except Exception:  # noqa: BLE001 — best-effort sweep; keep going
            logger.exception('Failed to clean up pending document %s', document_id)
    return deleted


@shared_task
def process_document_blob_deletions():
    """Retry durable document blob deletions until storage confirms success."""
    from api.services.documents import process_pending_blob_deletions

    return process_pending_blob_deletions()
