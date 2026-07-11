import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Deal } from '@/types/deal';
import { TransitionDialog } from './TransitionDialog';

const hooks = vi.hoisted(() => ({
  allowed: vi.fn(),
  pipeline: vi.fn(),
  syndication: vi.fn(),
}));

vi.mock('@/lib/api/deals', () => ({
  useAllowedTransitions: hooks.allowed,
  useTransitionPipeline: hooks.pipeline,
  useTransitionSyndication: hooks.syndication,
}));

const deal: Deal = {
  id: 'deal-1',
  name: 'Readiness Deal',
  investment_type: 'whole_loan_bridge',
  investment_category: 'debt',
  pipeline_status: 'screening',
  syndication_status: 'not_started',
  paused_from_status: null,
  sponsor: null,
  sponsor_detail: null,
  broker: null,
  broker_detail: null,
  assigned_analyst: 1,
  assigned_analyst_detail: { id: 1, username: 'analyst' },
  fund: null,
  fund_detail: null,
  source_channel: 'direct',
  source_date: '2026-07-10',
  requested_amount: '1000000.00',
  purpose: '',
  profile: '',
  estimated_value: null,
  renovation_budget: null,
  description: '',
  current_stage_entered_at: '2026-07-10T12:00:00Z',
  days_in_current_stage: 0,
  details: {},
  properties: [],
  created_at: '2026-07-10T12:00:00Z',
  updated_at: '2026-07-10T12:00:00Z',
};

function allowedResult(canOverride: boolean) {
  return {
    data: {
      pipeline_status: ['quoting', 'on_hold', 'dead'],
      syndication_status: [],
      readiness: {
        quoting: {
          ready: false,
          code: 'screening_approval_required',
          blockers: ['screening_assessment_missing'],
          can_override: canOverride,
        },
        on_hold: { ready: true, code: 'ready', blockers: [], can_override: false },
        dead: { ready: true, code: 'ready', blockers: [], can_override: false },
      },
    },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  };
}

describe('TransitionDialog', () => {
  const mutate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    hooks.pipeline.mockReturnValue({ mutate, isPending: false });
    hooks.syndication.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  it('distinguishes an allowed-transitions outage from no legal moves', async () => {
    const refetch = vi.fn();
    hooks.allowed.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch,
    });
    const user = userEvent.setup();

    render(
      <TransitionDialog deal={deal} kind="pipeline" open onOpenChange={vi.fn()} />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Available moves could not be loaded.');
    expect(screen.queryByText(/No moves are available/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('keeps a blocked transition disabled when the server denies override capability', async () => {
    hooks.allowed.mockReturnValue(allowedResult(false));
    const user = userEvent.setup();

    render(
      <TransitionDialog deal={deal} kind="pipeline" open onOpenChange={vi.fn()} />,
    );

    await user.selectOptions(screen.getByLabelText('Move to'), 'quoting');
    const readiness = screen.getByRole('status');
    expect(readiness).toHaveAttribute('aria-live', 'polite');
    expect(readiness).toHaveTextContent('Create a screening assessment before moving to Quoting.');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm move' })).toBeDisabled();
  });

  it('uses server-provided override capability and submits an explicit audited override', async () => {
    hooks.allowed.mockReturnValue(allowedResult(true));
    const user = userEvent.setup();

    render(
      <TransitionDialog deal={deal} kind="pipeline" open onOpenChange={vi.fn()} />,
    );

    await user.selectOptions(screen.getByLabelText('Move to'), 'quoting');
    await user.type(screen.getByRole('textbox', { name: /Reason/ }), '  Committee exception  ');
    const override = screen.getByRole('checkbox', { name: /Override readiness/ });
    await user.click(override);
    await user.click(screen.getByRole('button', { name: 'Confirm move' }));

    expect(mutate).toHaveBeenCalledOnce();
    expect(mutate.mock.calls[0][0]).toEqual({
      to_status: 'quoting',
      reason: 'Committee exception',
      override_readiness: true,
    });
  });
});
