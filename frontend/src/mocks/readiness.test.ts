import { beforeEach, describe, expect, it } from 'vitest';

import type { ActivityLogEntry, Deal, DealStageEvent, Paginated } from '@/types/deal';
import type { ScreeningAssessment } from '@/types/screening';
import { setDemoIsStaffForTests } from '@/config/flags';
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
    body: JSON.stringify({
      deal: dealId,
      ...(decision === 'advance' ? {
        loan_amount: '4000000',
        as_is_value: '6000000',
        project_cost: '5000000',
        noi: '500000',
        stabilized_noi: '600000',
        annual_debt_service: '350000',
        occupancy: '92.00',
        proposed_rate: '8.0000',
        proposed_term_months: 24,
        exit_strategy: 'Refinance after stabilization.',
        exit_cap_rate: '5.5000',
      } : {}),
    }),
  });
  return mockApiRequest<ScreeningAssessment>(
    `api/screening-assessments/${assessment.id}/finalize/`,
    { method: 'POST', body: JSON.stringify({ decision }) },
  );
}

describe('screening-to-quoting mock readiness', () => {
  beforeEach(() => {
    setDemoIsStaffForTests(true);
  });

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

describe('quoting-to-signed mock readiness', () => {
  beforeEach(() => {
    setDemoIsStaffForTests(true);
  });

  async function moveToQuoting(name: string): Promise<Deal> {
    const deal = await createScreeningDeal(name);
    await finalizeDecision(deal.id, 'advance');
    return mockApiRequest<Deal>(`api/deals/${deal.id}/transition/`, {
      method: 'POST',
      body: JSON.stringify({ to_status: 'quoting', reason: 'Screening approved.' }),
    });
  }

  it('blocks Negotiating until the current quote is sent, then Signed until executed', async () => {
    const deal = await moveToQuoting('Demo Quote Readiness');

    const quote = await mockApiRequest<{ id: string; status: string; version: number }>(
      'api/quotes/',
      {
        method: 'POST',
        body: JSON.stringify({ deal: deal.id, seed_from_screening: true }),
      },
    );
    expect(quote.status).toBe('draft');

    const draftBlocked = await mockApiRequest<ReadinessResponse>(
      `api/deals/${deal.id}/allowed-transitions/`,
    );
    expect(draftBlocked.readiness.negotiating).toMatchObject({
      ready: false,
      code: 'quote_readiness_required',
      blockers: ['quote_required_for_negotiating'],
      can_override: true,
    });

    await mockApiRequest(`api/quotes/${quote.id}/`, {
      method: 'PATCH',
      body: JSON.stringify({
        rate_type: 'fixed',
        amortization_type: 'interest_only',
        recourse_type: 'limited',
        expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      }),
    });
    await mockApiRequest(`api/quotes/${quote.id}/send/`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const sentReady = await mockApiRequest<ReadinessResponse>(
      `api/deals/${deal.id}/allowed-transitions/`,
    );
    expect(sentReady.readiness.negotiating).toEqual({
      ready: true,
      code: 'ready',
      blockers: [],
      can_override: false,
    });

    const negotiating = await mockApiRequest<Deal>(`api/deals/${deal.id}/transition/`, {
      method: 'POST',
      body: JSON.stringify({ to_status: 'negotiating', reason: 'Quote sent to borrower.' }),
    });
    expect(negotiating.pipeline_status).toBe('negotiating');

    const beforeExecute = await mockApiRequest<ReadinessResponse>(
      `api/deals/${deal.id}/allowed-transitions/`,
    );
    expect(beforeExecute.readiness.signed).toMatchObject({
      ready: false,
      code: 'quote_readiness_required',
      blockers: ['quote_execution_required'],
      can_override: true,
    });

    const intent = await mockApiRequest<{ document: { id: string } }>(
      'api/documents/upload-intent/',
      {
        method: 'POST',
        body: JSON.stringify({
          deal: deal.id,
          document_name: 'Executed Term Sheet',
          category: 'legal',
          subcategory: 'term_sheet',
          file_type: 'pdf',
          file_size_bytes: 32,
          content_type: 'application/pdf',
        }),
      },
    );
    await mockApiRequest(`api/documents/${intent.document.id}/complete/`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    await mockApiRequest(`api/quotes/${quote.id}/attachments/`, {
      method: 'POST',
      body: JSON.stringify({ document_ids: [intent.document.id] }),
    });
    await mockApiRequest(`api/quotes/${quote.id}/execute/`, {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const afterExecute = await mockApiRequest<ReadinessResponse>(
      `api/deals/${deal.id}/allowed-transitions/`,
    );
    expect(afterExecute.readiness.signed).toEqual({
      ready: true,
      code: 'ready',
      blockers: [],
      can_override: false,
    });
  });
});

describe('pipeline and syndication lifecycle consistency', () => {
  beforeEach(() => {
    setDemoIsStaffForTests(true);
  });

  async function moveToQuoting(name: string): Promise<Deal> {
    const deal = await createScreeningDeal(name);
    await finalizeDecision(deal.id, 'advance');
    return mockApiRequest<Deal>(`api/deals/${deal.id}/transition/`, {
      method: 'POST',
      body: JSON.stringify({ to_status: 'quoting', reason: 'Screening approved.' }),
    });
  }

  it('automatically cancels active syndication when a deal dies', async () => {
    const deal = await moveToQuoting('Demo Dead Syndication');
    await mockApiRequest(`api/deals/${deal.id}/transition-syndication/`, {
      method: 'POST',
      body: JSON.stringify({ to_status: 'raising', reason: 'Start raise.' }),
    });

    const dead = await mockApiRequest<Deal>(`api/deals/${deal.id}/transition/`, {
      method: 'POST',
      body: JSON.stringify({ to_status: 'dead', reason: 'Sponsor withdrew.' }),
    });

    expect(dead.pipeline_status).toBe('dead');
    expect(dead.syndication_status).toBe('cancelled');
    const activity = await mockApiRequest<Paginated<ActivityLogEntry>>(
      `api/activity-logs/?deal=${deal.id}`,
    );
    expect(activity.results).toContainEqual(expect.objectContaining({
      old_value: 'raising',
      new_value: 'cancelled',
      metadata: expect.objectContaining({
        automatic: true,
        trigger_pipeline_status: 'dead',
      }),
    }));
  });

  it('does not let a staff override exit with active syndication', async () => {
    const deal = await moveToQuoting('Demo Exit Syndication');
    await mockApiRequest(`api/deals/${deal.id}/transition-syndication/`, {
      method: 'POST',
      body: JSON.stringify({ to_status: 'raising', reason: 'Start raise.' }),
    });
    for (const toStatus of ['negotiating', 'signed', 'closing', 'closed', 'servicing']) {
      await mockApiRequest(`api/deals/${deal.id}/transition/`, {
        method: 'POST',
        body: JSON.stringify({
          to_status: toStatus,
          reason: `Advance to ${toStatus}.`,
          override_readiness: true,
        }),
      });
    }

    const readiness = await mockApiRequest<ReadinessResponse>(
      `api/deals/${deal.id}/allowed-transitions/`,
    );
    expect(readiness.readiness.exited).toEqual({
      ready: false,
      code: 'syndication_resolution_required',
      blockers: ['syndication_resolution_required'],
      can_override: false,
    });

    await expect(mockApiRequest(`api/deals/${deal.id}/transition/`, {
      method: 'POST',
      body: JSON.stringify({
        to_status: 'exited',
        reason: 'Asset sold.',
        override_readiness: true,
      }),
    })).rejects.toMatchObject({ status: 400 });

    await mockApiRequest(`api/deals/${deal.id}/transition-syndication/`, {
      method: 'POST',
      body: JSON.stringify({ to_status: 'cancelled', reason: 'Raise ended.' }),
    });
    const exited = await mockApiRequest<Deal>(`api/deals/${deal.id}/transition/`, {
      method: 'POST',
      body: JSON.stringify({ to_status: 'exited', reason: 'Asset sold.' }),
    });
    expect(exited.pipeline_status).toBe('exited');
    expect(exited.syndication_status).toBe('cancelled');
  });
});
