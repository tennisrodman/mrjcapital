import uuid

from django.db import models
from django.db.models import Q

from .choices import PropertyType


class Property(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    address_normalized = models.CharField(max_length=512, unique=True, db_index=True)
    address = models.CharField(max_length=255)
    city = models.CharField(max_length=120, db_index=True)
    state = models.CharField(max_length=2, db_index=True)
    zip = models.CharField(max_length=20)
    property_type = models.CharField(max_length=40, choices=PropertyType.choices)
    msa = models.CharField(max_length=160, blank=True, db_index=True)
    details = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['address_normalized']
        verbose_name_plural = 'properties'

    def __str__(self):
        return f'{self.address}, {self.city}, {self.state}'


class DealProperty(models.Model):
    deal = models.ForeignKey('Deal', on_delete=models.CASCADE, related_name='deal_properties')
    property = models.ForeignKey(Property, on_delete=models.CASCADE, related_name='deal_properties')
    is_primary = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['deal', 'property'], name='unique_deal_property'),
            models.UniqueConstraint(
                fields=['deal'],
                condition=Q(is_primary=True),
                name='unique_primary_property_per_deal',
            ),
        ]
        ordering = ['-is_primary', 'property__address_normalized']

    def __str__(self):
        return f'{self.deal_id} -> {self.property_id}'
