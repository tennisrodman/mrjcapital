import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('@/config/api', () => ({ apiRequest: api.request }));

import {
  createScreeningAssessment,
  finalizeScreeningAssessment,
  listScreeningAssessments,
  updateScreeningAssessment,
  useCreateScreeningAssessment,
  useFinalizeScreeningAssessment,
  useUpdateScreeningAssessment,
} from './screening';
import type {
  CreateScreeningAssessmentPayload,
  ScreeningAssessment,
  UpdateScreeningAssessmentPayload,
} from '@/types/screening';

const assessment = (version: number): ScreeningAssessment => ({
  id: `assessment-${version}`,
  deal: 'deal-1',
  version,
  is_current: version === 2,
  is_complete: true,
  missing_fields: [],
  status: version === 1 ? 'finalized' : 'draft',
  reviewer: version === 1 ? 1 : null,
  reviewer_detail: version === 1 ? { id: 1, username: 'analyst' } : null,
  loan_amount: '6500000',
  as_is_value: '10000000',
  stabilized_value: '12000000',
  project_cost: '8000000',
  noi: '1000000',
  stabilized_noi: '1200000',
  annual_debt_service: '700000',
  occupancy: '92.50',
  proposed_rate: '8.2500',
  proposed_term_months: 24,
  current_average_rent: '1850',
  market_rent: '2050',
  condition_rating: 'good',
  unit_mix: 'Mixed one- and two-bedroom units',
  exit_strategy: 'Refinance after stabilization.',
  exit_cap_rate: '5.5000',
  max_ltv: '0.7500',
  max_ltc: '0.8500',
  min_dscr: '1.2000',
  min_debt_yield: '0.0800',
  ltv_as_is: '0.6500',
  ltv_stabilized: '0.5417',
  ltc: '0.8125',
  dscr: '1.4286',
  debt_yield: '0.1538',
  quick_score: 100,
  equity_summary: '',
  equity_target_irr: null,
  equity_target_multiple: null,
  equity_target_hold_months: null,
  decision: version === 1 ? 'advance' : '',
  notes: '',
  created_at: '2026-01-01T12:00:00Z',
  updated_at: `2026-01-0${version}T12:00:00Z`,
  finalized_at: version === 1 ? '2026-01-01T12:00:00Z' : null,
});

const createPayload: CreateScreeningAssessmentPayload = {
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
  equity_summary: 'Sponsor is funding its co-investment from cash on hand.',
  equity_target_irr: null,
  equity_target_multiple: null,
  equity_target_hold_months: null,
  decision: 'advance',
  notes: 'Confirm the rent roll during diligence.',
};

const updatePayload: UpdateScreeningAssessmentPayload = {
  loan_amount: createPayload.loan_amount,
  as_is_value: createPayload.as_is_value,
  stabilized_value: createPayload.stabilized_value,
  project_cost: createPayload.project_cost,
  noi: createPayload.noi,
  stabilized_noi: createPayload.stabilized_noi,
  annual_debt_service: createPayload.annual_debt_service,
  occupancy: createPayload.occupancy,
  proposed_rate: createPayload.proposed_rate,
  proposed_term_months: createPayload.proposed_term_months,
  current_average_rent: createPayload.current_average_rent,
  market_rent: createPayload.market_rent,
  condition_rating: createPayload.condition_rating,
  unit_mix: createPayload.unit_mix,
  exit_strategy: createPayload.exit_strategy,
  exit_cap_rate: createPayload.exit_cap_rate,
  equity_summary: createPayload.equity_summary,
  equity_target_irr: createPayload.equity_target_irr,
  equity_target_multiple: createPayload.equity_target_multiple,
  equity_target_hold_months: createPayload.equity_target_hold_months,
  decision: createPayload.decision,
  notes: createPayload.notes,
};

describe('screening assessment API contract', () => {
  beforeEach(() => api.request.mockReset());

  it('filters assessments by an encoded deal id and loads every paginated result', async () => {
    api.request.mockImplementation((path?: string) => Promise.resolve(
      path?.endsWith('page=1')
        ? {
            count: 51,
            next: 'page=2',
            previous: null,
            results: [assessment(1)],
          }
        : path?.endsWith('page=2') ? {
            count: 51,
            next: null,
            previous: 'page=1',
            results: [assessment(2)],
          } : { count: 0, next: null, previous: null, results: [] },
    ));

    await expect(listScreeningAssessments('deal / 1')).resolves.toMatchObject([
      { id: 'assessment-2' },
      { id: 'assessment-1' },
    ]);
    expect(api.request).toHaveBeenCalledWith(
      'api/screening-assessments/?deal=deal%20%2F%201&page=1',
    );
    expect(api.request).toHaveBeenCalledWith(
      'api/screening-assessments/?deal=deal%20%2F%201&page=2',
    );
  });

  it('posts decimal-string inputs, patches drafts, and finalizes through the dedicated action', async () => {
    api.request.mockResolvedValue(assessment(2));

    await createScreeningAssessment(createPayload);
    await updateScreeningAssessment('assessment-2', updatePayload);
    await finalizeScreeningAssessment('assessment-2', {
      decision: 'advance',
      notes: 'Confirm the rent roll during diligence.',
    });

    expect(api.request).toHaveBeenNthCalledWith(1, 'api/screening-assessments/', {
      method: 'POST',
      body: JSON.stringify(createPayload),
    });
    expect(api.request).toHaveBeenNthCalledWith(2, 'api/screening-assessments/assessment-2/', {
      method: 'PATCH',
      body: JSON.stringify(updatePayload),
    });
    expect(api.request).toHaveBeenNthCalledWith(3, 'api/screening-assessments/assessment-2/finalize/', {
      method: 'POST',
      body: JSON.stringify({
        decision: 'advance',
        notes: 'Confirm the rent roll during diligence.',
      }),
    });
  });

  it('refreshes transition readiness after every screening mutation', async () => {
    api.request.mockResolvedValue(assessment(2));
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const created = renderHook(() => useCreateScreeningAssessment('deal-1'), { wrapper });
    const updated = renderHook(() => useUpdateScreeningAssessment('assessment-2', 'deal-1'), { wrapper });
    const finalized = renderHook(() => useFinalizeScreeningAssessment('assessment-2', 'deal-1'), { wrapper });

    await act(async () => {
      await created.result.current.mutateAsync(createPayload);
      await updated.result.current.mutateAsync(updatePayload);
      await finalized.result.current.mutateAsync({ decision: 'advance' });
    });

    expect(invalidate).toHaveBeenCalledTimes(3);
    expect(invalidate).toHaveBeenNthCalledWith(1, { queryKey: ['deal-allowed-transitions', 'deal-1'] });
    expect(invalidate).toHaveBeenNthCalledWith(2, { queryKey: ['deal-allowed-transitions', 'deal-1'] });
    expect(invalidate).toHaveBeenNthCalledWith(3, { queryKey: ['deal-allowed-transitions', 'deal-1'] });
  });

  it('demotes an older cached current assessment when a new version arrives', async () => {
    const current = { ...assessment(1), is_current: true };
    const incoming = assessment(2);
    api.request.mockResolvedValue(incoming);
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    queryClient.setQueryData(['screening-assessments', 'deal-1'], [current]);
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const created = renderHook(() => useCreateScreeningAssessment('deal-1'), { wrapper });

    await act(async () => {
      await created.result.current.mutateAsync(createPayload);
    });

    expect(queryClient.getQueryData<ScreeningAssessment[]>([
      'screening-assessments',
      'deal-1',
    ])).toEqual([
      expect.objectContaining({ id: 'assessment-2', is_current: true }),
      expect.objectContaining({ id: 'assessment-1', is_current: false }),
    ]);
  });
});
