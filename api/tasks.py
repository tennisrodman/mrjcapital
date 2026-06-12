from celery import shared_task


@shared_task
def heartbeat():
    """Periodic sanity-check task wired in CELERY_BEAT_SCHEDULE."""
    return 'ok'
