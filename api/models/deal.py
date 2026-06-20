import uuid
from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from django.utils import timezone

from .choices import InvestmentType, PipelineStatus, SourceChannel, SyndicationStatus


class Deal(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255, db_index=True)
    investment_type = models.CharField(max_length=32, choices=InvestmentType.choices)
    pipeline_status = models.CharField(
        max_length=24,
        choices=PipelineStatus.choices,
        default=PipelineStatus.SOURCED,
        db_index=True,
    )
    syndication_status = models.CharField(
        max_length=24,
        choices=SyndicationStatus.choices,
        default=SyndicationStatus.NOT_STARTED,
        db_index=True,
    )
    paused_from_status = models.CharField(
        max_length=24,
        choices=PipelineStatus.choices,
        null=True,
        blank=True,
    )
    sponsor = models.ForeignKey('Sponsor', on_delete=models.PROTECT, related_name='deals')
    broker = models.ForeignKey(
        'Broker',
        on_delete=models.PROTECT,
        related_name='deals',
        null=True,
        blank=True,
    )
    assigned_analyst = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='assigned_deals',
        null=True,
        blank=True,
    )
    fund = models.ForeignKey(
        'Fund',
        on_delete=models.SET_NULL,
        related_name='deals',
        null=True,
        blank=True,
    )
    source_channel = models.CharField(max_length=32, choices=SourceChannel.choices, db_index=True)
    source_date = models.DateField(default=timezone.localdate, db_index=True)
    requested_amount = models.DecimalField(
        max_digits=16,
        decimal_places=2,
        validators=[MinValueValidator(Decimal('0.01'))],
    )
    details = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-source_date', '-created_at']
        constraints = [
            models.CheckConstraint(
                condition=models.Q(requested_amount__gt=0),
                name='deal_requested_amount_positive',
            ),
        ]
        indexes = [
            models.Index(fields=['pipeline_status', 'syndication_status']),
            models.Index(fields=['assigned_analyst', 'pipeline_status']),
        ]

    def __str__(self):
        return self.name

    @property
    def investment_category(self):
        if self.investment_type in {
            InvestmentType.WHOLE_LOAN_BRIDGE,
            InvestmentType.WHOLE_LOAN_PERMANENT,
        }:
            return 'debt'
        if self.investment_type in {
            InvestmentType.MEZZANINE,
            InvestmentType.PREFERRED_EQUITY,
        }:
            return 'hybrid'
        return 'equity'
