import uuid

from django.core.validators import MaxValueValidator
from django.db import models

from api.fields import EncryptedTextField

from .choices import BrokerStatus, RelationshipRating, SponsorEntityType


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
    details = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['company_name', 'contact_name']

    def __str__(self):
        return f'{self.company_name} - {self.contact_name}'
