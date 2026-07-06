from celery import shared_task
from django.utils import timezone

from api.models import DocumentStorageStatus


@shared_task
def heartbeat():
    """Periodic sanity-check task wired in CELERY_BEAT_SCHEDULE."""
    return 'ok'


@shared_task
def cleanup_stale_pending_documents():
    """Remove abandoned pending uploads and their blob storage keys."""
    from datetime import timedelta
    import logging

    from django.conf import settings

    from api.models import Document
    from api.services.storage import get_document_storage

    logger = logging.getLogger(__name__)
    cutoff = timezone.now() - timedelta(hours=getattr(settings, 'DOCUMENT_PENDING_MAX_AGE_HOURS', 24))
    stale = Document.objects.filter(
        storage_status=DocumentStorageStatus.PENDING,
        uploaded_date__lt=cutoff,
    )
    storage = get_document_storage()
    deleted = 0
    for document in stale.iterator():
        try:
            if document.file_url:
                storage.delete_object(document.file_url)
            document.delete()
            deleted += 1
        except Exception:  # noqa: BLE001 — best-effort sweep; keep going
            logger.exception('Failed to clean up pending document %s', document.pk)
    return deleted
