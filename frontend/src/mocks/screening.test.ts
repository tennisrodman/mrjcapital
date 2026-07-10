import { describe, expect, it } from 'vitest';

import type { Paginated } from '@/types/deal';
import type { ScreeningAssessment } from '@/types/screening';
import { buildInitialDeals } from './fixtures';
import { mockApiRequest } from './handlers';

const dealId = buildInitialDeals()[0].id;

const payload = {
  deal: dealId,
  loan_amount: '6500000',
  as_is_value: '10000000',
  stabilized_value: '12000000',
  project_cost: '8000000',
  noi: '1000000',
  annual_debt_service: '700000',
  occupancy: '92.50',
  proposed_rate: '8.25',
  proposed_term_months: 24,
  equity_summary: 'Manual equity context only.',
  equity_target_irr: '18.0',
  equity_target_multiple: '1.8',
  equity_target_hold_months: 36,
  decision: 'advance',
  notes: 'Ready for final review.',
};

describe('screening mock API', () => {
  it('mirrors draft creation, deterministic metrics, and one-way finalization', async () => {
    const created = await mockApiRequest<ScreeningAssessment>('api/screening-assessments/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    expect(created).toMatchObject({
      deal: dealId,
      version: 1,
      status: 'draft',
      is_current: true,
      ltv_as_is: '0.6500',
      quick_score: 100,
    });

    const finalized = await mockApiRequest<ScreeningAssessment>(
      `api/screening-assessments/${created.id}/finalize/`,
      {
        method: 'POST',
        body: JSON.stringify({ decision: 'advance', notes: 'Approved for quoting.' }),
      },
    );
    expect(finalized).toMatchObject({
      status: 'finalized',
      decision: 'advance',
      notes: 'Approved for quoting.',
      reviewer: 1,
    });
    expect(finalized.finalized_at).not.toBeNull();

    await expect(
      mockApiRequest(`api/screening-assessments/${created.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ notes: 'Retroactive edit.' }),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('keeps version history while exposing only the latest assessment as current', async () => {
    const next = await mockApiRequest<ScreeningAssessment>('api/screening-assessments/', {
      method: 'POST',
      body: JSON.stringify({ ...payload, decision: '' }),
    });
    expect(next.version).toBe(2);

    const current = await mockApiRequest<Paginated<ScreeningAssessment>>(
      `api/screening-assessments/?deal=${dealId}&current=true`,
    );
    expect(current.results).toHaveLength(1);
    expect(current.results[0]).toMatchObject({ id: next.id, version: 2, is_current: true });
  });
});
