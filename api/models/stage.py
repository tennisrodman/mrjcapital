import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from .choices import PipelineStatus


class DealStageEvent(models.Model):
    """One tenure in the canonical pipeline-stage history for a deal."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    deal = models.ForeignKey('Deal', on_delete=models.PROTECT, related_name='stage_events')
    from_status = models.CharField(
        max_length=24,
        choices=PipelineStatus.choices,
        null=True,
        blank=True,
    )
    to_status = models.CharField(max_length=24, choices=PipelineStatus.choices, db_index=True)
    entered_at = models.DateTimeField(default=timezone.now, db_index=True)
    exited_at = models.DateTimeField(null=True, blank=True, db_index=True)
    performed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='stage_events',
        null=True,
        blank=True,
    )
    reason = models.TextField(blank=True)
    is_override = models.BooleanField(default=False)

    class Meta:
        ordering = ['-entered_at', '-id']
        indexes = [
            models.Index(fields=['deal', '-entered_at'], name='api_stage_deal_entered_idx'),
            models.Index(fields=['to_status', '-entered_at'], name='api_stage_status_entered_idx'),
        ]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(exited_at__isnull=True) | models.Q(exited_at__gte=models.F('entered_at')),
                name='stage_event_exit_after_entry',
            ),
            models.UniqueConstraint(
                fields=['deal'],
                condition=models.Q(exited_at__isnull=True),
                name='unique_open_stage_event_per_deal',
            ),
        ]

    def __str__(self):
        return f'{self.deal} → {self.to_status}'
