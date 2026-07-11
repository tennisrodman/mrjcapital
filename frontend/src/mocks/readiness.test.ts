import { describe, expect, it } from 'vitest';

import type { ActivityLogEntry, Deal, DealStageEvent, Paginated } from '@/types/deal';
import type { ScreeningAssessment } from '@/types/screening';
import { ApiError } from '@/lib/apiError';
import { mockApiRequest } from './handlers';

interface ReadinessResponse {
  pipeline_status: string[];
  syndication_status: string[];
  readiness: Record<string, {
    ready: boolean;
    code: string;
    blockers: string[];
    can_override: boolean;
  }>;
}

async function createScreeningDeal(name: string): Promise<Deal> {
  const deal = await mockApiRequest<Deal>('api/deals/', {
    method: 'POST',
    body: JSON.stringify({
      name,
      investment_type: 'whole_loan_bridge',
      requested_amount: '5000000.00',
      source_channel: 'direct',
      source_date: '2026-07-10',
    }),
  });
  return mockApiRequest<Deal>(`api/deals/${deal.id}/transition/`, {
    method: 'POST',
    body: JSON.stringify({ to_status: 'screening', reason: 'Ready for screening.' }),
  });
}

async function finalizeDecision(dealId: string, decision: 'advance' | 'refer' | 'decline') {
  const assessment = await mockApiRequest<ScreeningAssessment>('api/screening-assessments/', {
    method: 'POST',
    body: JSON.stringify({ deal: dealId }),
  });
  return mockApiRequest<ScreeningAssessment>(
    `api/screening-assessments/${assessment.id}/finalize/`,
    { method: 'POST', body: JSON.stringify({ decision }) },
  );
}

describe('screening-to-quoting mock readiness', () => {
  it('blocks quoting until the current finalized screening decision is advance', async () => {
    const deal = await createScreeningDeal('Demo Readiness Advance');

    const blocked = await mockApiRequest<ReadinessResponse>(
      `api/deals/${deal.id}/allowed-transitions/`,
    );
    expect(blocked.pipeline_status).toContain('quoting');
    expect(blocked.syndication_status).toEqual([]);
    expect(blocked.readiness.quoting).toMatchObject({
      ready: false,
      code: 'screening_approval_required',
      blockers: ['screening_assessment_missing'],
      can_override: true,
    });
    expect(Object.keys(blocked.readiness).sort()).toEqual([...blocked.pipeline_status].sort());
    expect(blocked.readiness.on_hold).toEqual({
      ready: true,
      code: 'ready',
      blockers: [],
      can_override: false,
    });

    let transitionError: unknown;
    try {
      await mockApiRequest(`api/deals/${deal.id}/transition/`, {
        method: 'POST',
        body: JSON.stringify({ to_status: 'quoting', reason: 'Premature quote.' }),
      });
    } catch (error) {
      transitionError = error;
    }
    expect(transitionError).toBeInstanceOf(ApiError);
    expect((transitionError as ApiError).data).toEqual({
      to_status: ['This pipeline transition is blocked by readiness requirements.'],
      readiness: blocked.readiness.quoting,
    });

    await finalizeDecision(deal.id, 'advance');
    const ready = await mockApiRequest<ReadinessResponse>(
      `api/deals/${deal.id}/allowed-transitions/`,
    );
    expect(ready.readiness.quoting).toEqual({
      ready: true,
      code: 'ready',
      blockers: [],
      can_override: false,
    });

    const transitioned = await mockApiRequest<Deal>(`api/deals/${deal.id}/transition/`, {
      method: 'POST',
      body: JSON.stringify({ to_status: 'quoting', reason: 'Screening approved.' }),
    });
    expect(transitioned.pipeline_status).toBe('quoting');
    const activity = await mockApiRequest<Paginated<ActivityLogEntry>>(
      `api/activity-logs/?deal=${deal.id}`,
    );
    expect(activity.results[0].metadata).toMatchObject({
      is_override: false,
      readiness_code: 'ready',
      readiness_blockers: [],
    });
    const quotingTransitions = await mockApiRequest<ReadinessResponse>(
      `api/deals/${deal.id}/allowed-transitions/`,
    );
    expect(quotingTransitions.syndication_status).toEqual(['raising']);
  });

  it('allows a staff override and audits the blocked readiness rule', async () => {
    const deal = await createScreeningDeal('Demo Readiness Override');
    await finalizeDecision(deal.id, 'refer');

    const blocked = await mockApiRequest<ReadinessResponse>(
      `api/deals/${deal.id}/allowed-transitions/`,
    );
    expect(blocked.readiness.quoting).toMatchObject({
      ready: false,
      code: 'screening_approval_required',
      blockers: ['screening_decision_not_advance'],
      can_override: true,
    });

    await mockApiRequest(`api/deals/${deal.id}/transition/`, {
      method: 'POST',
      body: JSON.stringify({
        to_status: 'quoting',
        reason: 'Investment committee approved an exception.',
        override_readiness: true,
      }),
    });

    const history = await mockApiRequest<Paginated<DealStageEvent>>(
      `api/deals/${deal.id}/stage-history/`,
    );
    expect(history.results[0]).toMatchObject({
      from_status: 'screening',
      to_status: 'quoting',
      is_override: true,
      reason: 'Investment committee approved an exception.',
    });

    const activity = await mockApiRequest<Paginated<ActivityLogEntry>>(
      `api/activity-logs/?deal=${deal.id}`,
    );
    expect(activity.results[0].metadata).toMatchObject({
      is_override: true,
      readiness_code: 'screening_approval_required',
      readiness_blockers: ['screening_decision_not_advance'],
    });
  });
});
