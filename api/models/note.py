import uuid

from django.conf import settings
from django.db import models


class DealNote(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    deal = models.ForeignKey('Deal', on_delete=models.CASCADE, related_name='notes')
    body = models.TextField()
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='deal_notes',
        null=True,
        blank=True,
    )
    attachments = models.ManyToManyField('Document', related_name='deal_notes', blank=True)
    visibility_roles = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at', '-id']
        indexes = [
            models.Index(fields=['deal', '-created_at']),
        ]

    def __str__(self):
        return f'Note on {self.deal_id} at {self.created_at:%Y-%m-%d %H:%M:%S}'
