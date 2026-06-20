import uuid

from django.conf import settings
from django.contrib.postgres.indexes import GinIndex
from django.db import models

from .choices import DocumentCategory


class Document(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    deal = models.ForeignKey('Deal', on_delete=models.PROTECT, related_name='documents')
    document_name = models.CharField(max_length=255)
    category = models.CharField(max_length=32, choices=DocumentCategory.choices)
    version = models.PositiveIntegerField(default=1)
    file_url = models.CharField(max_length=1024)
    file_type = models.CharField(max_length=24)
    uploaded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='uploaded_documents',
        null=True,
        blank=True,
    )
    uploaded_date = models.DateTimeField(auto_now_add=True)
    is_executed = models.BooleanField(default=False)
    expiry_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)
    visibility_roles = models.JSONField(default=list, blank=True)
    details = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['deal', 'category', '-version']
        indexes = [
            models.Index(fields=['deal', 'category']),
            models.Index(fields=['expiry_date']),
            GinIndex(fields=['visibility_roles'], name='api_document_roles_gin'),
        ]

    def __str__(self):
        return f'{self.document_name} v{self.version}'
