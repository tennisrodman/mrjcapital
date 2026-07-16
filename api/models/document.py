import uuid

from django.conf import settings
from django.contrib.postgres.indexes import GinIndex
from django.db import models

from .choices import DocumentCategory, DocumentStorageStatus, PipelineStatus


class Document(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    deal = models.ForeignKey('Deal', on_delete=models.PROTECT, related_name='documents')
    document_name = models.CharField(max_length=255)
    category = models.CharField(max_length=32, choices=DocumentCategory.choices)
    subcategory = models.CharField(max_length=64, blank=True)
    version = models.PositiveIntegerField(default=1)
    file_url = models.CharField(max_length=1024)
    file_type = models.CharField(max_length=24)
    content_type = models.CharField(max_length=127, blank=True)
    file_size_bytes = models.PositiveBigIntegerField(null=True, blank=True)
    checksum_sha256 = models.CharField(max_length=64, blank=True)
    storage_status = models.CharField(
        max_length=16,
        choices=DocumentStorageStatus.choices,
        default=DocumentStorageStatus.PENDING,
        db_index=True,
    )
    pipeline_stage_at_upload = models.CharField(
        max_length=24,
        choices=PipelineStatus.choices,
        null=True,
        blank=True,
    )
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
        # `id` makes the default order deterministic across paginated queries,
        # including documents with the same category and version.
        ordering = ['deal', 'category', '-version', 'id']
        indexes = [
            models.Index(fields=['deal', 'category']),
            models.Index(fields=['deal', 'storage_status'], name='api_documen_deal_id_stor_idx'),
            models.Index(fields=['storage_status', 'uploaded_date'], name='api_documen_storag_upl_idx'),
            models.Index(fields=['expiry_date']),
            GinIndex(fields=['visibility_roles'], name='api_document_roles_gin'),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['deal', 'category', 'document_name', 'version'],
                name='unique_document_version',
            ),
        ]

    def __str__(self):
        return f'{self.document_name} v{self.version}'
