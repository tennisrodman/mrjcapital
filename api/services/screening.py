"""Transaction-safe debt-first screening assessment workflows."""

from decimal import Decimal, ROUND_HALF_UP

from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from api.models.deal import Deal
from api.models.screening import ScreeningAssessment


RATIO_QUANTUM = Decimal('0.0001')
SCORE_QUANTUM = Decimal('1')
HUNDRED = Decimal('100')

DEFAULT_THRESHOLDS = {
    'max_ltv': Decimal('0.7500'),
    'max_ltc': Decimal('0.8500'),
    'min_dscr': Decimal('1.2000'),
    'min_debt_yield': Decimal('0.0800'),
}

CALCULATED_FIELDS = (
    'ltv_as_is',
    'ltv_stabilized',
    'ltc',
    'dscr',
    'debt_yield',
    'quick_score',
)

SCREENING_REQUIRED_FOR_ADVANCE = (
    'loan_amount',
    'project_cost',
    'noi',
    'stabilized_noi',
    'annual_debt_service',
    'occupancy',
    'proposed_rate',
    'proposed_term_months',
    'exit_strategy',
    'exit_cap_rate',
)

# The service owns these fields.  They are never accepted through draft
# creation/update, which prevents callers from choosing a version, forging a
# reviewer, or supplying stale calculated values.
PROTECTED_FIELDS = {
    'id',
    'version',
    'status',
    'reviewer',
    'finalized_at',
    'created_at',
    'updated_at',
    *CALCULATED_FIELDS,
}


def calculate_screening_metrics(
    *,
    loan_amount,
    as_is_value=None,
    stabilized_value=None,
    project_cost=None,
    noi=None,
    annual_debt_service=None,
    max_ltv=DEFAULT_THRESHOLDS['max_ltv'],
    max_ltc=DEFAULT_THRESHOLDS['max_ltc'],
    min_dscr=DEFAULT_THRESHOLDS['min_dscr'],
    min_debt_yield=DEFAULT_THRESHOLDS['min_debt_yield'],
):
    """Return deterministic, four-decimal ratios and the 0-100 quick score.

    All ratios are fractional values: ``0.7500`` is 75%.  A missing or
    non-positive denominator returns ``None`` instead of raising, making an
    incomplete draft safe to save and showing that a metric is unavailable.
    The score gives equal weight to each available debt metric; an incomplete
    assessment with no usable metric scores zero.
    """
    loan_amount = _decimal_or_none(loan_amount)
    as_is_value = _decimal_or_none(as_is_value)
    stabilized_value = _decimal_or_none(stabilized_value)
    project_cost = _decimal_or_none(project_cost)
    noi = _decimal_or_none(noi)
    annual_debt_service = _decimal_or_none(annual_debt_service)
    max_ltv = _decimal_or_none(max_ltv)
    max_ltc = _decimal_or_none(max_ltc)
    min_dscr = _decimal_or_none(min_dscr)
    min_debt_yield = _decimal_or_none(min_debt_yield)

    ltv_as_is = _safe_ratio(loan_amount, as_is_value)
    ltv_stabilized = _safe_ratio(loan_amount, stabilized_value)
    ltc = _safe_ratio(loan_amount, project_cost)
    dscr = _safe_ratio(noi, annual_debt_service)
    debt_yield = _safe_ratio(noi, loan_amount)

    checks = []
    score_ltv = ltv_as_is if ltv_as_is is not None else ltv_stabilized
    if score_ltv is not None and max_ltv is not None:
        checks.append(score_ltv <= max_ltv)
    if ltc is not None and max_ltc is not None:
        checks.append(ltc <= max_ltc)
    if dscr is not None and min_dscr is not None:
        checks.append(dscr >= min_dscr)
    if debt_yield is not None and min_debt_yield is not None:
        checks.append(debt_yield >= min_debt_yield)

    quick_score = 0
    if len(checks) == 4:
        quick_score = int(
            (Decimal(sum(checks)) * HUNDRED / Decimal(len(checks))).quantize(
                SCORE_QUANTUM,
                rounding=ROUND_HALF_UP,
            )
        )

    return {
        'ltv_as_is': ltv_as_is,
        'ltv_stabilized': ltv_stabilized,
        'ltc': ltc,
        'dscr': dscr,
        'debt_yield': debt_yield,
        'quick_score': quick_score,
    }


def apply_calculated_metrics(assessment):
    """Populate stored ratios and score from an assessment's input snapshot."""
    metrics = calculate_screening_metrics(
        loan_amount=assessment.loan_amount,
        as_is_value=assessment.as_is_value,
        stabilized_value=assessment.stabilized_value,
        project_cost=assessment.project_cost,
        noi=assessment.noi,
        annual_debt_service=assessment.annual_debt_service,
        max_ltv=assessment.max_ltv,
        max_ltc=assessment.max_ltc,
        min_dscr=assessment.min_dscr,
        min_debt_yield=assessment.min_debt_yield,
    )
    for field_name, value in metrics.items():
        setattr(assessment, field_name, value)
    return assessment


def create_next_assessment(*, deal, **fields):
    """Create the next immutable-history version for ``deal``.

    Locking the Deal row serializes competing version allocation requests; the
    unique database constraint remains the backstop in every deployment.
    """
    _reject_protected_fields(fields)
    with transaction.atomic():
        locked_deal = Deal.objects.select_for_update().get(pk=deal.pk)
        _require_screening_stage(locked_deal)
        current = ScreeningAssessment.objects.filter(deal=locked_deal).order_by('-version').first()
        if current and current.status == ScreeningAssessment.Status.DRAFT:
            raise ValidationError({
                'status': 'Update or finalize the current draft before starting a new version.',
            })
        next_version = (current.version if current else 0) + 1
        assessment = ScreeningAssessment(
            deal=locked_deal,
            version=next_version,
            status=ScreeningAssessment.Status.DRAFT,
            **fields,
        )
        apply_calculated_metrics(assessment)
        assessment.full_clean()
        assessment.save()
        return assessment


def update_draft_assessment(*, assessment, **fields):
    """Update a draft under a row lock and recalculate its deterministic outputs."""
    _reject_protected_fields(fields)
    if 'deal' in fields:
        raise ValidationError({'deal': 'An assessment cannot be moved to another deal.'})

    with transaction.atomic():
        locked_assessment = ScreeningAssessment.objects.select_for_update().get(pk=assessment.pk)
        _require_current_draft(locked_assessment)
        _require_screening_stage(locked_assessment.deal)
        for field_name, value in fields.items():
            setattr(locked_assessment, field_name, value)
        apply_calculated_metrics(locked_assessment)
        locked_assessment.full_clean()
        locked_assessment.save(update_fields=[*fields.keys(), *CALCULATED_FIELDS, 'updated_at'])
        return locked_assessment


def finalize_assessment(*, assessment, reviewer, decision, notes=None):
    """Atomically freeze a draft with a reviewer, decision, and timestamp."""
    if not getattr(reviewer, 'is_authenticated', False):
        raise ValidationError({'reviewer': 'An authenticated reviewer is required.'})
    if decision not in ScreeningAssessment.Decision.values:
        raise ValidationError({'decision': 'Select a supported screening decision.'})

    with transaction.atomic():
        locked_assessment = ScreeningAssessment.objects.select_for_update().get(pk=assessment.pk)
        _require_current_draft(locked_assessment)
        _require_screening_stage(locked_assessment.deal)
        if decision == ScreeningAssessment.Decision.ADVANCE:
            advance_errors = screening_advance_errors(locked_assessment)
            if advance_errors:
                raise ValidationError(advance_errors)
        locked_assessment.decision = decision
        if notes is not None:
            locked_assessment.notes = notes
        locked_assessment.reviewer = reviewer
        locked_assessment.finalized_at = timezone.now()
        locked_assessment.status = ScreeningAssessment.Status.FINALIZED
        apply_calculated_metrics(locked_assessment)
        locked_assessment.full_clean()
        locked_assessment.save(
            update_fields=[
                'decision',
                'notes',
                'reviewer',
                'finalized_at',
                'status',
                *CALCULATED_FIELDS,
                'updated_at',
            ]
        )
        return locked_assessment


def get_current_assessment(deal):
    """Return the latest version for a deal, or ``None`` when it has none."""
    return ScreeningAssessment.objects.filter(deal=deal).order_by('-version').first()


def screening_missing_fields(assessment):
    """Return fields that are absent or unusable for an Advance decision."""
    return list(screening_advance_errors(assessment))


def screening_advance_errors(assessment):
    errors = {
        field_name: 'Required before an assessment can advance.'
        for field_name in SCREENING_REQUIRED_FOR_ADVANCE
        if getattr(assessment, field_name, None) in (None, '')
    }
    for field_name in ('loan_amount', 'project_cost', 'annual_debt_service'):
        value = getattr(assessment, field_name, None)
        if value not in (None, '') and value <= 0:
            errors[field_name] = 'Must be greater than zero before an assessment can advance.'

    valuation_fields = ('as_is_value', 'stabilized_value')
    provided_valuations = [
        getattr(assessment, field_name, None)
        for field_name in valuation_fields
        if getattr(assessment, field_name, None) not in (None, '')
    ]
    if not provided_valuations:
        errors['as_is_value'] = 'Provide an as-is or stabilized value before advancing.'
    else:
        for field_name in valuation_fields:
            value = getattr(assessment, field_name, None)
            if value not in (None, '') and value <= 0:
                errors[field_name] = 'Must be greater than zero before an assessment can advance.'
    return errors


def screening_is_complete(assessment):
    return not screening_missing_fields(assessment)


def _decimal_or_none(value):
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value
    return Decimal(str(value))


def _safe_ratio(numerator, denominator):
    if numerator is None or denominator is None or denominator <= 0:
        return None
    return (numerator / denominator).quantize(RATIO_QUANTUM, rounding=ROUND_HALF_UP)


def _require_draft(assessment):
    if assessment.status != ScreeningAssessment.Status.DRAFT:
        raise ValidationError({'status': 'Only draft screening assessments can be changed.'})


def _require_current_draft(assessment):
    _require_draft(assessment)
    if ScreeningAssessment.objects.filter(
        deal_id=assessment.deal_id,
        version__gt=assessment.version,
    ).exists():
        raise ValidationError({'status': 'Only the current draft can be changed.'})


def _reject_protected_fields(fields):
    protected = sorted(set(fields) & PROTECTED_FIELDS)
    if protected:
        raise ValidationError({field_name: 'This field is managed by the screening workflow.' for field_name in protected})


def _require_screening_stage(deal):
    if deal.pipeline_status not in {'sourced', 'screening'}:
        raise ValidationError({
            'deal': 'Screening can only be created or changed while the deal is sourced or screening.',
        })
