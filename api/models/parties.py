import uuid
from decimal import Decimal

from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models

from api.fields import EncryptedTextField

from .choices import (
    BrokerCommissionType,
    BrokerStatus,
    RelationshipRating,
    SponsorConnectionSource,
    SponsorEntityType,
)


class Sponsor(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    entity_name = models.CharField(max_length=255, db_index=True)
    entity_type = models.CharField(max_length=24, choices=SponsorEntityType.choices)
    primary_contact_name = models.CharField(max_length=255)
    primary_contact_email = models.EmailField(db_index=True)
    primary_contact_phone = models.CharField(max_length=40, blank=True)
    relationship_rating = models.CharField(
        max_length=24,
        choices=RelationshipRating.choices,
        default=RelationshipRating.NEW,
    )
    ein = EncryptedTextField(blank=True)
    guarantor_net_worth = EncryptedTextField(blank=True)
    guarantor_liquidity = EncryptedTextField(blank=True)
    guarantor_credit_score = EncryptedTextField(blank=True)
    website = models.URLField(blank=True)
    years_experience = models.PositiveSmallIntegerField(
        null=True,
        blank=True,
        validators=[MaxValueValidator(200)],
    )
    completed_projects = models.PositiveIntegerField(null=True, blank=True)
    bankruptcy_history = models.BooleanField(null=True, blank=True)
    business_address = models.TextField(blank=True)
    total_units_owned = models.PositiveIntegerField(null=True, blank=True)
    total_sf_managed = models.PositiveBigIntegerField(null=True, blank=True)
    assets_under_management = models.DecimalField(
        max_digits=18,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0'))],
    )
    track_record = models.JSONField(default=list, blank=True)
    connection_source = models.CharField(
        max_length=32,
        choices=SponsorConnectionSource.choices,
        blank=True,
    )
    details = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['entity_name']
        constraints = [
            models.CheckConstraint(
                condition=models.Q(years_experience__isnull=True) | models.Q(years_experience__lte=200),
                name='sponsor_years_experience_range',
            ),
        ]

    def __str__(self):
        return self.entity_name


class Broker(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company_name = models.CharField(max_length=255, db_index=True)
    contact_name = models.CharField(max_length=255)
    email = models.EmailField(db_index=True)
    phone = models.CharField(max_length=40, blank=True)
    status = models.CharField(max_length=16, choices=BrokerStatus.choices, default=BrokerStatus.ACTIVE)
    default_commission_rate = models.DecimalField(
        max_digits=8,
        decimal_places=4,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0'))],
    )
    commission_type = models.CharField(
        max_length=32,
        choices=BrokerCommissionType.choices,
        blank=True,
    )
    preferred_deal_types = models.JSONField(default=list, blank=True)
    geographic_focus = models.JSONField(default=list, blank=True)
    details = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['company_name', 'contact_name']

    def __str__(self):
        return f'{self.company_name} - {self.contact_name}'
