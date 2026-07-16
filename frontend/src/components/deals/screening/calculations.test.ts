import { describe, expect, it } from 'vitest';

import type { CreateScreeningAssessmentPayload } from '@/types/screening';
import { calculateDebtMetrics, toDecimalString, toPositiveInteger } from './calculations';

const COMPLETE_INPUTS: CreateScreeningAssessmentPayload = {
  deal: 'deal-1',
  loan_amount: '6500000',
  as_is_value: '10000000',
  stabilized_value: '12000000',
  project_cost: '8000000',
  noi: '1000000',
  stabilized_noi: '1200000',
  annual_debt_service: '700000',
  occupancy: '92.50',
  proposed_rate: '8.25',
  proposed_term_months: 24,
  current_average_rent: '1850',
  market_rent: '2050',
  condition_rating: 'good',
  unit_mix: 'Mixed one- and two-bedroom units',
  exit_strategy: 'Refinance after stabilization.',
  exit_cap_rate: '5.5000',
  equity_summary: '',
  equity_target_irr: null,
  equity_target_multiple: null,
  equity_target_hold_months: null,
  decision: '',
  notes: '',
};

describe('debt screening calculations', () => {
  it('calculates the debt-first output set using decimal-string inputs', () => {
    expect(calculateDebtMetrics(COMPLETE_INPUTS)).toEqual({
      ltv_as_is: '0.6500',
      ltv_stabilized: '0.5417',
      ltc: '0.8125',
      dscr: '1.4286',
      debt_yield: '0.1538',
      quick_score: 100,
    });
  });

  it('does not fabricate outputs when a denominator is zero or absent', () => {
    const metrics = calculateDebtMetrics({
      ...COMPLETE_INPUTS,
      loan_amount: null,
      as_is_value: '0',
      project_cost: null,
      noi: null,
      annual_debt_service: null,
    });

    expect(metrics.ltv_as_is).toBeNull();
    expect(metrics.ltc).toBeNull();
    expect(metrics.dscr).toBeNull();
    expect(metrics.quick_score).toBe(0);
  });

  it('canonicalizes user formatting before values cross the API boundary', () => {
    expect(toDecimalString(' 1,250,000.50 ')).toBe('1250000.50');
    expect(toDecimalString('12.')).toBeNull();
    expect(toDecimalString('not a number')).toBeNull();
    expect(toPositiveInteger('24')).toBe(24);
    expect(toPositiveInteger('24.5')).toBeNull();
  });

  it('rounds ratios before threshold scoring exactly like backend Decimal math', () => {
    const boundary = {
      ...COMPLETE_INPUTS,
      loan_amount: '75004',
      as_is_value: '100000',
      stabilized_value: null,
      project_cost: '100000',
      noi: '10000',
      annual_debt_service: '8000',
    };

    expect(calculateDebtMetrics(boundary)).toMatchObject({
      ltv_as_is: '0.7500',
      quick_score: 100,
    });
    expect(calculateDebtMetrics({ ...boundary, loan_amount: '75005' })).toMatchObject({
      ltv_as_is: '0.7501',
      quick_score: 75,
    });
  });
});
