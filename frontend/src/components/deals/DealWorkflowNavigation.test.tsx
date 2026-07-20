import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { DealWorkflowNavigation } from './DealWorkflowNavigation';
import type { AllowedTransitions } from '@/lib/api/deals';
import type { Deal } from '@/types/deal';

const deal = {
  id: 'deal-1',
  pipeline_status: 'quoting',
  paused_from_status: null,
} as Deal;

const transitions: AllowedTransitions = {
  pipeline_status: ['dead', 'negotiating', 'on_hold'],
  syndication_status: ['raising'],
  readiness: {
    negotiating: {
      ready: false,
      code: 'quote_required',
      blockers: ['Send a quote', 'Attach evidence'],
      can_override: true,
    },
  },
};

function renderNavigation(overrides: Partial<React.ComponentProps<typeof DealWorkflowNavigation>> = {}) {
  render(
    <MemoryRouter>
      <DealWorkflowNavigation
        deal={deal}
        allowedTransitions={transitions}
        transitionsLoading={false}
        showClosingLink={false}
        onMoveStage={vi.fn()}
        onSyndication={vi.fn()}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

describe('DealWorkflowNavigation', () => {
  it('shows the lifecycle in chronological order and marks the current stage', () => {
    renderNavigation();

    const lifecycle = screen.getByRole('list', { name: 'Deal lifecycle stages' });
    const labels = within(lifecycle).getAllByRole('listitem').map((item) => item.textContent);
    expect(labels).toEqual([
      expect.stringContaining('Sourced'),
      expect.stringContaining('Screening'),
      expect.stringContaining('Quoting'),
      expect.stringContaining('Negotiating'),
      expect.stringContaining('Signed'),
      expect.stringContaining('Closing'),
      expect.stringContaining('Closed'),
      expect.stringContaining('Servicing'),
      expect.stringContaining('Exited'),
    ]);
    expect(within(lifecycle).getByText('Quoting').closest('li')).toHaveAttribute('aria-current', 'step');
  });

  it('separates available moves, chronological workspaces, and deal tools', () => {
    renderNavigation();

    expect(screen.getByText('Negotiating · 2 requirements')).toBeInTheDocument();
    const workspaces = screen.getByRole('navigation', { name: 'Workflow workspaces' });
    expect(within(workspaces).getAllByRole('link').map((link) => link.textContent)).toEqual([
      expect.stringContaining('1. Screening'),
      expect.stringContaining('2. Quotes'),
    ]);
    expect(screen.getByText('Deal tools')).toBeInTheDocument();
  });

  it('shows where an on-hold deal paused on the main path', () => {
    renderNavigation({
      deal: { ...deal, pipeline_status: 'on_hold', paused_from_status: 'quoting' } as Deal,
    });

    expect(screen.getByText('Current stage: On hold')).toBeInTheDocument();
    expect(screen.getByText('Paused from Quoting')).toBeInTheDocument();
    expect(screen.getByText('Paused here').closest('li')).toHaveAttribute('aria-current', 'step');
  });
});
