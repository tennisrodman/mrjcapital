import uuid
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


class ScreeningAssessment(models.Model):
    """A versioned, point-in-time first-pass underwriting assessment.

    Calculated ratio fields are persisted so a finalized assessment remains a
    faithful snapshot even if screening policy changes later.  Ratios use a
    fractional representation (``0.7500`` means 75%) rather than a percentage
    representation.
    """

    class Status(models.TextChoices):
        DRAFT = 'draft', 'Draft'
        FINALIZED = 'finalized', 'Finalized'

    class Decision(models.TextChoices):
        ADVANCE = 'advance', 'Advance'
        REFER = 'refer', 'Refer'
        DECLINE = 'decline', 'Decline'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    deal = models.ForeignKey('Deal', on_delete=models.PROTECT, related_name='screening_assessments')
    version = models.PositiveIntegerField()
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT, db_index=True)

    reviewer = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='reviewed_screening_assessments',
        null=True,
        blank=True,
    )
    finalized_at = models.DateTimeField(null=True, blank=True)
    decision = models.CharField(max_length=16, choices=Decision.choices, blank=True, default='')
    notes = models.TextField(blank=True)

    # Debt inputs.  loan_amount is deliberately snapshot data rather than a
    # live reference to Deal.requested_amount, so every assessment version is
    # reproducible if the deal changes after screening.
    loan_amount = models.DecimalField(
        max_digits=16,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0'))],
    )
    as_is_value = models.DecimalField(
        max_digits=16,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0'))],
    )
    stabilized_value = models.DecimalField(
        max_digits=16,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0'))],
    )
    project_cost = models.DecimalField(
        max_digits=16,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0'))],
    )
    noi = models.DecimalField(
        max_digits=16,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0'))],
    )
    annual_debt_service = models.DecimalField(
        max_digits=16,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0'))],
    )
    occupancy = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('100'))],
        help_text='Percent occupied, from 0 through 100.',
    )
    proposed_rate = models.DecimalField(
        max_digits=7,
        decimal_places=4,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('100'))],
        help_text='Annual proposed interest rate expressed as a percentage.',
    )
    proposed_term_months = models.PositiveIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(1)],
    )

    # Explicit, versioned threshold fields are the underwriting-policy
    # snapshot for this record.  LTV/LTC/debt-yield thresholds are fractions.
    max_ltv = models.DecimalField(
        max_digits=8,
        decimal_places=4,
        default=Decimal('0.7500'),
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('1'))],
    )
    max_ltc = models.DecimalField(
        max_digits=8,
        decimal_places=4,
        default=Decimal('0.8500'),
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('1'))],
    )
    min_dscr = models.DecimalField(
        max_digits=8,
        decimal_places=4,
        default=Decimal('1.2000'),
        validators=[MinValueValidator(Decimal('0'))],
    )
    min_debt_yield = models.DecimalField(
        max_digits=8,
        decimal_places=4,
        default=Decimal('0.0800'),
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('1'))],
    )

    # Stored deterministic outputs.  All are read-only at the API boundary.
    ltv_as_is = models.DecimalField(max_digits=12, decimal_places=4, null=True, blank=True, editable=False)
    ltv_stabilized = models.DecimalField(max_digits=12, decimal_places=4, null=True, blank=True, editable=False)
    ltc = models.DecimalField(max_digits=12, decimal_places=4, null=True, blank=True, editable=False)
    dscr = models.DecimalField(max_digits=12, decimal_places=4, null=True, blank=True, editable=False)
    debt_yield = models.DecimalField(max_digits=12, decimal_places=4, null=True, blank=True, editable=False)
    quick_score = models.PositiveSmallIntegerField(
        default=0,
        editable=False,
        validators=[MinValueValidator(0), MaxValueValidator(100)],
    )

    # Equity screening intentionally remains manual and target-oriented; this
    # model does not model, derive, or distribute a waterfall.
    equity_summary = models.TextField(blank=True)
    equity_target_irr = models.DecimalField(
        max_digits=7,
        decimal_places=4,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0')), MaxValueValidator(Decimal('100'))],
        help_text='Target IRR expressed as a percentage.',
    )
    equity_target_multiple = models.DecimalField(
        max_digits=8,
        decimal_places=4,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0'))],
    )
    equity_target_hold_months = models.PositiveIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(1)],
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['deal', '-version']
        constraints = [
            models.UniqueConstraint(
                fields=['deal', 'version'],
                name='screening_assessment_deal_version_unique',
            ),
            models.UniqueConstraint(
                fields=['deal'],
                condition=models.Q(status='draft'),
                name='screening_assessment_one_draft_per_deal',
            ),
            models.CheckConstraint(
                condition=models.Q(version__gt=0),
                name='screening_assessment_version_positive',
            ),
            models.CheckConstraint(
                condition=models.Q(quick_score__gte=0, quick_score__lte=100),
                name='screening_assessment_score_range',
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(occupancy__isnull=True)
                    | models.Q(occupancy__gte=0, occupancy__lte=100)
                ),
                name='screening_assessment_occupancy_range',
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(status='draft', reviewer__isnull=True, finalized_at__isnull=True)
                    | (
                        models.Q(status='finalized', reviewer__isnull=False, finalized_at__isnull=False)
                        & ~models.Q(decision='')
                    )
                ),
                name='screening_assessment_finalization_state',
            ),
        ]
        indexes = [
            models.Index(fields=['deal', '-version'], name='screening_deal_version_idx'),
            models.Index(fields=['deal', 'status'], name='screening_deal_status_idx'),
        ]

    def __str__(self):
        return f'{self.deal_id} screening v{self.version}'

    @property
    def is_current(self):
        """Whether this is the highest assessment version for its deal.

        This is intentionally derived instead of a persisted flag: creating a
        newer version must not mutate a finalized historical record.
        """
        if not self.deal_id or not self.version:
            return False
        return not type(self)._base_manager.filter(
            deal_id=self.deal_id,
            version__gt=self.version,
        ).exists()

    def clean(self):
        super().clean()
        errors = {}
        if self.status == self.Status.FINALIZED:
            if not self.reviewer_id:
                errors['reviewer'] = 'A reviewer is required when finalizing an assessment.'
            if not self.finalized_at:
                errors['finalized_at'] = 'A finalized assessment requires a finalization timestamp.'
            if not self.decision:
                errors['decision'] = 'A finalized assessment requires a decision.'
        elif self.status == self.Status.DRAFT:
            if self.reviewer_id:
                errors['reviewer'] = 'Draft assessments cannot have a reviewer.'
            if self.finalized_at:
                errors['finalized_at'] = 'Draft assessments cannot have a finalization timestamp.'
        if errors:
            raise ValidationError(errors)

    def save(self, *args, **kwargs):
        # Guard normal model saves as well as the REST endpoint.  The service
        # locks and checks status too; this prevents an accidental internal
        # caller from editing a finalized record through model.save().
        if self.pk and not self._state.adding:
            existing = type(self)._base_manager.filter(pk=self.pk).values('status').first()
            if existing and existing['status'] == self.Status.FINALIZED:
                raise ValidationError('Finalized screening assessments are immutable.')
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        if self.pk and not self._state.adding:
            raise ValidationError('Screening assessment versions cannot be deleted.')
        return super().delete(*args, **kwargs)
