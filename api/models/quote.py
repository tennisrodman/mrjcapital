import uuid
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


class Quote(models.Model):
    """A versioned term sheet / LOI proposal for a deal.

    Draft rows are editable. Non-draft rows are immutable except for explicit
    workflow transitions that pass ``update_fields`` limited to status/timestamps.
    """

    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        SENT = 'sent', 'Sent'
        COUNTERED = 'countered', 'Countered'
        EXECUTED = 'executed', 'Executed'
        EXPIRED = 'expired', 'Expired'
        WITHDRAWN = 'withdrawn', 'Withdrawn'

    class RateType(models.TextChoices):
        FIXED = 'fixed', 'Fixed'
        FLOATING = 'floating', 'Floating'
        HYBRID = 'hybrid', 'Hybrid'

    class AmortizationType(models.TextChoices):
        INTEREST_ONLY = 'interest_only', 'Interest only'
        PARTIAL_AMORT = 'partial_amort', 'Partial amort'
        FULL_AMORT = 'full_amort', 'Full amort'

    class RecourseType(models.TextChoices):
        FULL = 'full', 'Full'
        LIMITED = 'limited', 'Limited'
        NON_RECOURSE = 'non_recourse', 'Non-recourse with carveouts'

    WORKFLOW_UPDATE_FIELDS = frozenset({
        'status',
        'sent_at',
        'expires_at',
        'signed_at',
        'withdrawn_at',
        'updated_at',
    })

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    deal = models.ForeignKey('Deal', on_delete=models.PROTECT, related_name='quotes')
    version = models.PositiveIntegerField()
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.DRAFT,
        db_index=True,
    )
    is_counter = models.BooleanField(default=False)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='created_quotes',
        null=True,
        blank=True,
    )
    sent_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    signed_at = models.DateTimeField(null=True, blank=True)
    withdrawn_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)

    loan_amount = models.DecimalField(
        max_digits=16,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0'))],
    )
    rate_type = models.CharField(max_length=16, choices=RateType.choices, blank=True, default='')
    interest_rate = models.DecimalField(
        max_digits=7,
        decimal_places=4,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('100'))],
        help_text='Annual interest rate in percentage points.',
    )
    index_name = models.CharField(max_length=64, blank=True)
    spread = models.DecimalField(
        max_digits=7,
        decimal_places=4,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('100'))],
    )
    rate_floor = models.DecimalField(
        max_digits=7,
        decimal_places=4,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('100'))],
    )
    term_months = models.PositiveIntegerField(null=True, blank=True, validators=[MinValueValidator(1)])
    amortization_type = models.CharField(
        max_length=16,
        choices=AmortizationType.choices,
        blank=True,
        default='',
    )
    amortization_months = models.PositiveIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(1)],
    )
    origination_fee_pct = models.DecimalField(
        max_digits=7,
        decimal_places=4,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('100'))],
    )
    origination_fee_amount = models.DecimalField(
        max_digits=16,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0'))],
    )
    exit_fee_pct = models.DecimalField(
        max_digits=7,
        decimal_places=4,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('100'))],
    )
    extension_options = models.JSONField(default=list, blank=True)
    prepayment_terms = models.TextField(blank=True)
    recourse_type = models.CharField(
        max_length=16,
        choices=RecourseType.choices,
        blank=True,
        default='',
    )
    recourse_carveouts = models.TextField(blank=True)
    interest_reserve_months = models.PositiveIntegerField(null=True, blank=True)
    interest_reserve_amount = models.DecimalField(
        max_digits=16,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0'))],
    )
    holdback_amount = models.DecimalField(
        max_digits=16,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0'))],
    )
    initial_funding_amount = models.DecimalField(
        max_digits=16,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0'))],
    )
    good_faith_deposit = models.DecimalField(
        max_digits=16,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0'))],
    )
    min_dscr = models.DecimalField(
        max_digits=8,
        decimal_places=4,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0'))],
    )
    max_ltv = models.DecimalField(
        max_digits=8,
        decimal_places=4,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('1'))],
    )
    min_debt_yield = models.DecimalField(
        max_digits=8,
        decimal_places=4,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('1'))],
    )

    equity_commitment = models.DecimalField(
        max_digits=16,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0'))],
    )
    ownership_pct = models.DecimalField(
        max_digits=7,
        decimal_places=4,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('100'))],
    )
    preferred_return_pct = models.DecimalField(
        max_digits=7,
        decimal_places=4,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('100'))],
    )
    equity_summary = models.TextField(blank=True)

    attachments = models.ManyToManyField('Document', related_name='quotes', blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['deal', '-version']
        constraints = [
            models.UniqueConstraint(
                fields=['deal', 'version'],
                name='quote_deal_version_unique',
            ),
            models.UniqueConstraint(
                fields=['deal'],
                condition=models.Q(status='draft'),
                name='quote_one_draft_per_deal',
            ),
            models.CheckConstraint(
                condition=models.Q(version__gt=0),
                name='quote_version_positive',
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(
                        status='draft',
                        sent_at__isnull=True,
                        signed_at__isnull=True,
                        withdrawn_at__isnull=True,
                    )
                    | models.Q(
                        status__in=['sent', 'countered', 'expired'],
                        sent_at__isnull=False,
                        signed_at__isnull=True,
                        withdrawn_at__isnull=True,
                    )
                    | models.Q(
                        status='executed',
                        sent_at__isnull=False,
                        signed_at__isnull=False,
                        withdrawn_at__isnull=True,
                    )
                    | models.Q(
                        status='withdrawn',
                        withdrawn_at__isnull=False,
                        signed_at__isnull=True,
                    )
                ),
                name='quote_lifecycle_timestamps',
            ),
        ]
        indexes = [
            models.Index(fields=['deal', 'status'], name='quote_deal_status_idx'),
            models.Index(fields=['deal', '-version'], name='quote_deal_version_idx'),
        ]

    def __str__(self):
        return f'Quote v{self.version} ({self.status}) for {self.deal_id}'

    @property
    def is_current(self):
        if not self.deal_id or not self.version:
            return False
        return not type(self)._base_manager.filter(
            deal_id=self.deal_id,
            version__gt=self.version,
        ).exists()

    def save(self, *args, **kwargs):
        if self.pk and not self._state.adding:
            existing = type(self)._base_manager.filter(pk=self.pk).values('status').first()
            if existing and existing['status'] != self.Status.DRAFT:
                update_fields = kwargs.get('update_fields')
                if update_fields is None:
                    raise ValidationError('Non-draft quotes are immutable.')
                allowed = set(update_fields)
                # Transitions must include status so expires_at / timestamps
                # cannot be patched alone outside the workflow services.
                if 'status' not in allowed:
                    raise ValidationError('Non-draft quotes are immutable.')
                disallowed = allowed - self.WORKFLOW_UPDATE_FIELDS
                if disallowed:
                    raise ValidationError('Non-draft quotes are immutable.')
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.pk and not self._state.adding:
            raise ValidationError('Quote versions cannot be deleted.')
        return super().delete(*args, **kwargs)
