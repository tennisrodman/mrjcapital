import uuid

from django.db import models

from .choices import FundStatus


class Fund(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255, db_index=True)
    status = models.CharField(max_length=16, choices=FundStatus.choices, default=FundStatus.FORMING)
    details = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name
