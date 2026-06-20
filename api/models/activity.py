import uuid

from django.conf import settings
from django.contrib.postgres.indexes import GinIndex
from django.db import models
from django.utils import timezone

from .choices import ActivityActionType


class ActivityLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    deal = models.ForeignKey(
        'Deal',
        on_delete=models.SET_NULL,
        related_name='activity_logs',
        null=True,
        blank=True,
    )
    action_type = models.CharField(max_length=40, choices=ActivityActionType.choices, db_index=True)
    performed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='activity_logs',
        null=True,
        blank=True,
    )
    performed_at = models.DateTimeField(auto_now_add=True, db_index=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)
    description = models.TextField()
    old_value = models.TextField(blank=True)
    new_value = models.TextField(blank=True)
    reason = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['-performed_at', '-id']
        indexes = [
            models.Index(fields=['deal', '-performed_at']),
            models.Index(fields=['action_type', '-performed_at']),
            GinIndex(fields=['metadata'], name='api_activity_metadata_gin'),
        ]

    def __str__(self):
        return f'{self.action_type} at {self.performed_at:%Y-%m-%d %H:%M:%S}'
