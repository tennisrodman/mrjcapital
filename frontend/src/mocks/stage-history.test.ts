import { describe, expect, it } from 'vitest';

import type { Deal, DealStageEvent, Paginated } from '@/types/deal';
import { ACTIVITY, buildInitialDeals } from './fixtures';
import { mockApiRequest } from './handlers';

const sourcedDeal = buildInitialDeals().find((deal) => deal.pipeline_status === 'sourced');
const advancedDeal = buildInitialDeals().find((deal) => {
  const latest = ACTIVITY.find((entry) => entry.deal === deal.id);
  return deal.pipeline_status !== 'sourced' && latest?.new_value === deal.pipeline_status;
});

describe('stage history mock API', () => {
  it('closes the current tenure and opens a new event with the transition reason', async () => {
    expect(sourcedDeal).toBeDefined();
    const deal = sourcedDeal as Deal;

    await mockApiRequest(`api/deals/${deal.id}/transition/`, {
      method: 'POST',
      body: JSON.stringify({ to_status: 'screening', reason: 'Package received.' }),
    });
    const response = await mockApiRequest<Paginated<DealStageEvent>>(`api/deals/${deal.id}/stage-history/`);
    const events = response.results;

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      from_status: 'sourced',
      to_status: 'screening',
      reason: 'Package received.',
      exited_at: null,
    });
    expect(events[1].to_status).toBe('sourced');
    expect(events[1].exited_at).not.toBeNull();
  });

  it('reconstructs an advanced seeded deal instead of fabricating one source-date tenure', async () => {
    expect(advancedDeal).toBeDefined();
    const deal = advancedDeal as Deal;
    const logs = ACTIVITY.filter((entry) => entry.deal === deal.id);
    const latest = logs[0];

    const response = await mockApiRequest<Paginated<DealStageEvent>>(`api/deals/${deal.id}/stage-history/`);
    const events = response.results;

    expect(events).toHaveLength(logs.length + 1);
    expect(events[0]).toMatchObject({
      to_status: deal.pipeline_status,
      entered_at: latest.performed_at,
      exited_at: null,
    });
    expect(events.slice(1).every((event) => event.exited_at !== null)).toBe(true);
  });
});
