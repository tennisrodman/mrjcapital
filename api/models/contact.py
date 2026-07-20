import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.db.models.functions import Lower


class DealContactRole(models.TextChoices):
    SOURCE_CONTACT = 'source_contact', 'Source contact'
    SPONSOR_CONTACT = 'sponsor_contact', 'Sponsor contact'
    BROKER_CONTACT = 'broker_contact', 'Broker contact'
    BORROWER_COUNSEL = 'borrower_counsel', 'Borrower counsel'
    LENDER_COUNSEL = 'lender_counsel', 'Lender counsel'
    CLOSING_CONTACT = 'closing_contact', 'Closing contact'


class Contact(models.Model):
    """A reusable person record for the internal Release 1 deal workflow.

    Organization/CRM behavior is intentionally deferred. ``company_name`` keeps
    the person useful until that later normalization without embedding another
    name/email/phone tuple directly on Deal.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    full_name = models.CharField(max_length=255, db_index=True)
    title = models.CharField(max_length=160, blank=True)
    company_name = models.CharField(max_length=255, blank=True, db_index=True)
    email = models.EmailField(blank=True, db_index=True)
    phone = models.CharField(max_length=40, blank=True)
    details = models.JSONField(default=dict, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='created_contacts',
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['full_name', 'company_name', 'id']
        constraints = [
            models.UniqueConstraint(
                Lower('email'),
                condition=~Q(email=''),
                name='contact_email_ci_unique',
            ),
        ]

    def __str__(self):
        if self.company_name:
            return f'{self.full_name} — {self.company_name}'
        return self.full_name


class DealContact(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    deal = models.ForeignKey('Deal', on_delete=models.CASCADE, related_name='contact_links')
    contact = models.ForeignKey(Contact, on_delete=models.PROTECT, related_name='deal_links')
    role = models.CharField(max_length=32, choices=DealContactRole.choices, db_index=True)
    is_primary = models.BooleanField(default=False)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['deal', 'role', '-is_primary', 'contact__full_name']
        constraints = [
            models.UniqueConstraint(
                fields=['deal', 'contact', 'role'],
                name='unique_deal_contact_role',
            ),
            models.UniqueConstraint(
                fields=['deal', 'role'],
                condition=Q(is_primary=True),
                name='unique_primary_contact_per_deal_role',
            ),
        ]
        indexes = [
            models.Index(fields=['deal', 'role'], name='api_dealcon_deal_id_role_idx'),
            models.Index(fields=['contact', 'role'], name='api_dealcon_contact_role_idx'),
        ]

    def __str__(self):
        return f'{self.deal_id}: {self.contact} ({self.role})'
