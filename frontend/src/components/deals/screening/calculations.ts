import type {
  CreateScreeningAssessmentPayload,
  DebtScreeningOutputs,
  DecimalString,
  ScreeningAssessment,
  ScreeningAssessmentFormValues,
} from '@/types/screening';

const DECIMAL_PATTERN = /^(?:\d+|\d*\.\d+)$/;
const INTEGER_PATTERN = /^\d+$/;

export function toDecimalString(value: string): DecimalString | null {
  const normalized = value.trim().replace(/,/g, '');
  return normalized && DECIMAL_PATTERN.test(normalized) ? normalized : null;
}

export function toPositiveInteger(value: string): number | null {
  const normalized = value.trim();
  if (!normalized || !INTEGER_PATTERN.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function isPositiveDecimal(value: string): boolean {
  const normalized = toDecimalString(value);
  return normalized !== null && Number(normalized) > 0;
}

export function isOptionalDecimal(value: string): boolean {
  return value.trim() === '' || toDecimalString(value) !== null;
}

export function isOptionalPositiveInteger(value: string): boolean {
  return value.trim() === '' || toPositiveInteger(value) !== null;
}

export function screeningPayloadFromForm(
  values: ScreeningAssessmentFormValues,
  deal: string,
): CreateScreeningAssessmentPayload {
  return {
    deal,
    loan_amount: toDecimalString(values.loan_amount),
    as_is_value: toDecimalString(values.as_is_value),
    stabilized_value: toDecimalString(values.stabilized_value),
    project_cost: toDecimalString(values.project_cost),
    noi: toDecimalString(values.noi),
    stabilized_noi: toDecimalString(values.stabilized_noi),
    annual_debt_service: toDecimalString(values.annual_debt_service),
    occupancy: toDecimalString(values.occupancy),
    proposed_rate: toDecimalString(values.proposed_rate),
    proposed_term_months: toPositiveInteger(values.proposed_term_months),
    current_average_rent: toDecimalString(values.current_average_rent),
    market_rent: toDecimalString(values.market_rent),
    condition_rating: values.condition_rating,
    unit_mix: values.unit_mix.trim(),
    exit_strategy: values.exit_strategy.trim(),
    exit_cap_rate: toDecimalString(values.exit_cap_rate),
    equity_summary: values.equity_summary.trim(),
    equity_target_irr: toDecimalString(values.equity_target_irr),
    equity_target_multiple: toDecimalString(values.equity_target_multiple),
    equity_target_hold_months: toPositiveInteger(values.equity_target_hold_months),
    decision: values.decision,
    notes: values.notes.trim(),
  };
}

interface QuantizedRatio {
  /** Ratio in ten-thousandths, matching the backend's Decimal(0.0001) quantum. */
  units: bigint;
  formatted: DecimalString;
}

function decimalFraction(value: DecimalString | null): { integer: bigint; scale: bigint } | null {
  if (value === null || !DECIMAL_PATTERN.test(value)) return null;
  const [whole = '0', fraction = ''] = value.split('.');
  const digits = `${whole || '0'}${fraction}`;
  return {
    integer: BigInt(digits || '0'),
    scale: 10n ** BigInt(fraction.length),
  };
}

/** Decimal ROUND_HALF_UP division to four places, without JS floating point. */
function quantizedRatio(
  numeratorValue: DecimalString | null,
  denominatorValue: DecimalString | null,
): QuantizedRatio | null {
  const numerator = decimalFraction(numeratorValue);
  const denominator = decimalFraction(denominatorValue);
  if (!numerator || !denominator || denominator.integer <= 0n) return null;

  const scaledNumerator = numerator.integer * denominator.scale * 10_000n;
  const scaledDenominator = denominator.integer * numerator.scale;
  let units = scaledNumerator / scaledDenominator;
  if ((scaledNumerator % scaledDenominator) * 2n >= scaledDenominator) units += 1n;
  const whole = units / 10_000n;
  const fraction = (units % 10_000n).toString().padStart(4, '0');
  return { units, formatted: `${whole}.${fraction}` };
}

/** Mirrors api.services.screening.calculate_screening_metrics for live feedback. */
export function calculateDebtMetrics(
  inputs: Pick<
    CreateScreeningAssessmentPayload,
    'loan_amount' | 'as_is_value' | 'stabilized_value' | 'project_cost' | 'noi' | 'annual_debt_service'
  >,
): DebtScreeningOutputs {
  const ltvAsIs = quantizedRatio(inputs.loan_amount, inputs.as_is_value);
  const ltvStabilized = quantizedRatio(inputs.loan_amount, inputs.stabilized_value);
  const ltc = quantizedRatio(inputs.loan_amount, inputs.project_cost);
  const dscr = quantizedRatio(inputs.noi, inputs.annual_debt_service);
  const debtYield = quantizedRatio(inputs.noi, inputs.loan_amount);

  const checks: boolean[] = [];
  const scoreLtv = ltvAsIs ?? ltvStabilized;
  if (scoreLtv !== null) checks.push(scoreLtv.units <= 7_500n);
  if (ltc !== null) checks.push(ltc.units <= 8_500n);
  if (dscr !== null) checks.push(dscr.units >= 12_000n);
  if (debtYield !== null) checks.push(debtYield.units >= 800n);

  return {
    ltv_as_is: ltvAsIs?.formatted ?? null,
    ltv_stabilized: ltvStabilized?.formatted ?? null,
    ltc: ltc?.formatted ?? null,
    dscr: dscr?.formatted ?? null,
    debt_yield: debtYield?.formatted ?? null,
    quick_score: checks.length === 4
      ? Math.round((checks.filter(Boolean).length * 100) / checks.length)
      : 0,
  };
}

export function assessmentMetrics(assessment: ScreeningAssessment): DebtScreeningOutputs {
  return {
    ltv_as_is: assessment.ltv_as_is,
    ltv_stabilized: assessment.ltv_stabilized,
    ltc: assessment.ltc,
    dscr: assessment.dscr,
    debt_yield: assessment.debt_yield,
    quick_score: assessment.quick_score,
  };
}

export function assessmentToFormValues(
  assessment: ScreeningAssessment | undefined,
  defaultLoanAmount = '',
): ScreeningAssessmentFormValues {
  return {
    loan_amount: assessment?.loan_amount ?? defaultLoanAmount,
    as_is_value: assessment?.as_is_value ?? '',
    stabilized_value: assessment?.stabilized_value ?? '',
    project_cost: assessment?.project_cost ?? '',
    noi: assessment?.noi ?? '',
    stabilized_noi: assessment?.stabilized_noi ?? '',
    annual_debt_service: assessment?.annual_debt_service ?? '',
    occupancy: assessment?.occupancy ?? '',
    proposed_rate: assessment?.proposed_rate ?? '',
    proposed_term_months: assessment?.proposed_term_months?.toString() ?? '',
    current_average_rent: assessment?.current_average_rent ?? '',
    market_rent: assessment?.market_rent ?? '',
    condition_rating: assessment?.condition_rating ?? '',
    unit_mix: assessment?.unit_mix ?? '',
    exit_strategy: assessment?.exit_strategy ?? '',
    exit_cap_rate: assessment?.exit_cap_rate ?? '',
    equity_summary: assessment?.equity_summary ?? '',
    equity_target_irr: assessment?.equity_target_irr ?? '',
    equity_target_multiple: assessment?.equity_target_multiple ?? '',
    equity_target_hold_months: assessment?.equity_target_hold_months?.toString() ?? '',
    decision: assessment?.decision ?? '',
    notes: assessment?.notes ?? '',
  };
}

export function screeningIsComplete(payload: CreateScreeningAssessmentPayload): boolean {
  return Boolean(
    payload.loan_amount
      && (payload.as_is_value || payload.stabilized_value)
      && payload.project_cost
      && payload.noi
      && payload.stabilized_noi
      && payload.annual_debt_service
      && payload.occupancy
      && payload.proposed_rate
      && payload.proposed_term_months
      && payload.exit_strategy
      && payload.exit_cap_rate,
  );
}
