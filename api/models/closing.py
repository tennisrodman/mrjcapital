"""Closing package, checklist generations, DD items, and conditions precedent."""

from __future__ import annotations

import uuid
from decimal import Decimal

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models
from django.db.models import Q


ORDINARY_REGENERATION_REASON = 'ordinary_regeneration'


class ClosingUndeletableQuerySet(models.QuerySet):
    """Block queryset.delete() so history cannot be wiped outside instance guards."""

    def delete(self):
        raise ValidationError('Closing records cannot be deleted via queryset.')


class ClosingItemQuerySet(models.QuerySet):
    """Block raw queryset deletion; audited services use QuerySet.delete directly."""

    def delete(self):
        raise ValidationError(
            'Closing checklist items cannot be deleted via queryset; use the audited service.',
        )


ClosingUndeletableManager = models.Manager.from_queryset(ClosingUndeletableQuerySet)
ClosingItemManager = models.Manager.from_queryset(ClosingItemQuerySet)


class DDTemplate(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    key = models.CharField(max_length=64, unique=True)
    name = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class DDTemplateItem(models.Model):
    class Kind(models.TextChoices):
        DD = 'dd', 'Due diligence'
        CP = 'cp', 'Condition precedent'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    template = models.ForeignKey(DDTemplate, on_delete=models.CASCADE, related_name='items')
    sort_order = models.PositiveIntegerField()
    kind = models.CharField(max_length=8, choices=Kind.choices)
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    default_days_before_target_close = models.IntegerField(null=True, blank=True)

    class Meta:
        ordering = ['kind', 'sort_order']
        constraints = [
            models.UniqueConstraint(
                fields=['template', 'kind', 'sort_order'],
                name='unique_dd_template_item_sort',
            ),
        ]

    def __str__(self):
        return f'{self.template.key}:{self.kind}:{self.title}'


class ClosingPackage(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    deal = models.OneToOneField(
        'Deal',
        on_delete=models.PROTECT,
        related_name='closing_package',
    )
    target_close_date = models.DateField(null=True, blank=True)
    actual_close_date = models.DateField(null=True, blank=True)
    funds_wired_date = models.DateField(null=True, blank=True)
    funds_wired_amount = models.DecimalField(
        max_digits=16,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0.01'))],
    )
    closing_attorney = models.CharField(max_length=255, blank=True)
    title_company = models.CharField(max_length=255, blank=True)
    purchase_price = models.DecimalField(
        max_digits=16,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0'))],
    )
    appraised_value = models.DecimalField(
        max_digits=16,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0'))],
    )
    final_loan_amount = models.DecimalField(
        max_digits=16,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0.01'))],
    )
    closing_costs = models.DecimalField(
        max_digits=16,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal('0'))],
    )
    sources_and_uses_notes = models.TextField(blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = ClosingUndeletableManager()

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f'ClosingPackage({self.deal_id})'

    def delete(self, *args, **kwargs):
        if self.pk and not self._state.adding:
            raise ValidationError('Closing packages cannot be deleted.')
        return super().delete(*args, **kwargs)


class ClosingChecklistGeneration(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    package = models.ForeignKey(
        ClosingPackage,
        on_delete=models.PROTECT,
        related_name='generations',
    )
    version = models.PositiveIntegerField()
    template = models.ForeignKey(
        DDTemplate,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='generations',
    )
    template_key = models.CharField(max_length=64)
    template_name = models.CharField(max_length=255)
    is_current = models.BooleanField(default=True, db_index=True)
    generated_at = models.DateTimeField()
    generated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='generated_closing_checklists',
    )
    superseded_at = models.DateTimeField(null=True, blank=True)
    superseded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='superseded_closing_checklists',
    )
    supersede_reason = models.TextField(blank=True)

    objects = ClosingUndeletableManager()

    class Meta:
        ordering = ['-version']
        constraints = [
            models.UniqueConstraint(fields=['package', 'version'], name='unique_closing_generation_version'),
            models.UniqueConstraint(
                fields=['package'],
                condition=Q(is_current=True),
                name='unique_current_closing_generation',
            ),
            models.CheckConstraint(condition=Q(version__gt=0), name='closing_generation_version_positive'),
            models.CheckConstraint(
                condition=(
                    Q(
                        is_current=True,
                        superseded_at__isnull=True,
                        superseded_by__isnull=True,
                        supersede_reason='',
                    )
                    | Q(is_current=False, superseded_at__isnull=False)
                ),
                name='closing_generation_current_or_superseded',
            ),
            models.CheckConstraint(
                condition=Q(superseded_at__isnull=True) | Q(superseded_at__gte=models.F('generated_at')),
                name='closing_generation_superseded_after_generated',
            ),
        ]

    def __str__(self):
        return f'ClosingGeneration(v{self.version}, current={self.is_current})'

    def delete(self, *args, **kwargs):
        if self.pk and not self._state.adding:
            raise ValidationError('Closing checklist generations cannot be deleted.')
        return super().delete(*args, **kwargs)


class DDChecklistItem(models.Model):
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        IN_PROGRESS = 'in_progress', 'In progress'
        COMPLETE = 'complete', 'Complete'
        WAIVED = 'waived', 'Waived'

    TERMINAL_STATUSES = frozenset({Status.COMPLETE, Status.WAIVED})

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    generation = models.ForeignKey(
        ClosingChecklistGeneration,
        on_delete=models.CASCADE,
        related_name='dd_items',
    )
    source_template_item = models.ForeignKey(
        DDTemplateItem,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='dd_items',
    )
    sort_order = models.PositiveIntegerField()
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.PENDING,
        db_index=True,
    )
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='owned_dd_items',
    )
    due_date = models.DateField(null=True, blank=True)
    waiver_reason = models.TextField(blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='completed_dd_items',
    )
    waived_at = models.DateTimeField(null=True, blank=True)
    waived_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='waived_dd_items',
    )
    documents = models.ManyToManyField('Document', blank=True, related_name='dd_checklist_items')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_dd_items',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = ClosingItemManager()

    class Meta:
        ordering = ['sort_order', 'created_at']
        constraints = [
            models.UniqueConstraint(fields=['generation', 'sort_order'], name='unique_dd_item_sort'),
            models.CheckConstraint(
                condition=(
                    (
                        Q(status='complete')
                        & Q(completed_at__isnull=False)
                        & Q(waived_at__isnull=True)
                        & Q(waiver_reason='')
                    )
                    | (
                        Q(status='waived')
                        & Q(waived_at__isnull=False)
                        & ~Q(waiver_reason='')
                        & Q(completed_at__isnull=True)
                    )
                    | (
                        Q(status__in=['pending', 'in_progress'])
                        & Q(completed_at__isnull=True)
                        & Q(waived_at__isnull=True)
                        & Q(waiver_reason='')
                    )
                ),
                name='dd_item_status_timestamps',
            ),
        ]

    def __str__(self):
        return f'DD({self.title}, {self.status})'

    @property
    def is_terminal(self):
        return self.status in self.TERMINAL_STATUSES

    def delete(self, *args, **kwargs):
        if self.pk and not self._state.adding and not getattr(self, '_closing_allow_delete', False):
            raise ValidationError(
                'Closing checklist items cannot be deleted directly; use the audited service.',
            )
        return super().delete(*args, **kwargs)


class ConditionPrecedent(models.Model):
    class Status(models.TextChoices):
        OPEN = 'open', 'Open'
        SATISFIED = 'satisfied', 'Satisfied'
        WAIVED = 'waived', 'Waived'

    TERMINAL_STATUSES = frozenset({Status.SATISFIED, Status.WAIVED})

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    generation = models.ForeignKey(
        ClosingChecklistGeneration,
        on_delete=models.CASCADE,
        related_name='conditions_precedent',
    )
    source_template_item = models.ForeignKey(
        DDTemplateItem,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='condition_precedents',
    )
    sort_order = models.PositiveIntegerField()
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    status = models.CharField(
        max_length=16,
        choices=Status.choices,
        default=Status.OPEN,
        db_index=True,
    )
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='owned_conditions_precedent',
    )
    due_date = models.DateField(null=True, blank=True)
    waiver_reason = models.TextField(blank=True)
    satisfied_at = models.DateTimeField(null=True, blank=True)
    satisfied_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='satisfied_conditions_precedent',
    )
    waived_at = models.DateTimeField(null=True, blank=True)
    waived_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='waived_conditions_precedent',
    )
    documents = models.ManyToManyField('Document', blank=True, related_name='condition_precedents')
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='created_conditions_precedent',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = ClosingItemManager()

    class Meta:
        ordering = ['sort_order', 'created_at']
        verbose_name_plural = 'conditions precedent'
        constraints = [
            models.UniqueConstraint(fields=['generation', 'sort_order'], name='unique_cp_item_sort'),
            models.CheckConstraint(
                condition=(
                    (
                        Q(status='satisfied')
                        & Q(satisfied_at__isnull=False)
                        & Q(waived_at__isnull=True)
                        & Q(waiver_reason='')
                    )
                    | (
                        Q(status='waived')
                        & Q(waived_at__isnull=False)
                        & ~Q(waiver_reason='')
                        & Q(satisfied_at__isnull=True)
                    )
                    | (
                        Q(status='open')
                        & Q(satisfied_at__isnull=True)
                        & Q(waived_at__isnull=True)
                        & Q(waiver_reason='')
                    )
                ),
                name='cp_item_status_timestamps',
            ),
        ]

    def __str__(self):
        return f'CP({self.title}, {self.status})'

    @property
    def is_terminal(self):
        return self.status in self.TERMINAL_STATUSES

    def delete(self, *args, **kwargs):
        if self.pk and not self._state.adding and not getattr(self, '_closing_allow_delete', False):
            raise ValidationError(
                'Conditions precedent cannot be deleted directly; use the audited service.',
            )
        return super().delete(*args, **kwargs)
