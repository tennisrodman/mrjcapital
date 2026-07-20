import uuid
from decimal import Decimal

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.db.models import Q

from .choices import PropertyEnvironmentalStatus, PropertyType


class Property(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    address_normalized = models.CharField(max_length=512, unique=True, db_index=True)
    address = models.CharField(max_length=255)
    city = models.CharField(max_length=120, db_index=True)
    state = models.CharField(max_length=2, db_index=True)
    zip = models.CharField(max_length=20)
    property_type = models.CharField(max_length=40, choices=PropertyType.choices)
    subtype = models.CharField(max_length=120, blank=True)
    units = models.PositiveIntegerField(null=True, blank=True)
    rentable_square_feet = models.PositiveBigIntegerField(null=True, blank=True)
    year_built = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(1700), MaxValueValidator(2200)],
    )
    year_renovated = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(1700), MaxValueValidator(2200)],
    )
    county = models.CharField(max_length=120, blank=True, db_index=True)
    msa = models.CharField(max_length=160, blank=True, db_index=True)
    number_of_buildings = models.PositiveIntegerField(null=True, blank=True)
    number_of_stories = models.PositiveIntegerField(null=True, blank=True)
    parking_spaces = models.PositiveIntegerField(null=True, blank=True)
    lot_size_acres = models.DecimalField(
        max_digits=12,
        decimal_places=4,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0'))],
    )
    flood_zone = models.CharField(max_length=32, blank=True)
    zoning_designation = models.CharField(max_length=80, blank=True)
    environmental_status = models.CharField(
        max_length=32,
        choices=PropertyEnvironmentalStatus.choices,
        blank=True,
    )
    details = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['address_normalized']
        verbose_name_plural = 'properties'
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(year_built__isnull=True)
                    | models.Q(year_built__gte=1700, year_built__lte=2200)
                ),
                name='property_year_built_range',
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(year_renovated__isnull=True)
                    | models.Q(year_renovated__gte=1700, year_renovated__lte=2200)
                ),
                name='property_year_renovated_range',
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(year_built__isnull=True)
                    | models.Q(year_renovated__isnull=True)
                    | models.Q(year_renovated__gte=models.F('year_built'))
                ),
                name='property_renovation_after_built',
            ),
        ]

    def __str__(self):
        return f'{self.address}, {self.city}, {self.state}'

    def clean(self):
        super().clean()
        if self.year_built and self.year_renovated and self.year_renovated < self.year_built:
            from django.core.exceptions import ValidationError

            raise ValidationError({'year_renovated': 'Year renovated cannot be earlier than year built.'})


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
