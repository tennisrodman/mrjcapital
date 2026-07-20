import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthContext } from '@/context/AuthContext';
import DealEditPage from './DealEditPage';

const hooks = vi.hoisted(() => {
  const query = (data: unknown) => ({
    data,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });

  return {
    deal: query({
      id: 'deal-1',
      name: 'Test Deal',
      investment_type: 'whole_loan_bridge',
      requested_amount: '1000000.00',
      purpose: 'acquisition',
      profile: 'stabilized',
      estimated_value: null,
      renovation_budget: null,
      description: '',
      source_channel: 'direct',
      source_date: '2026-07-15',
      sponsor: null,
      broker: null,
      fund: null,
      assigned_analyst: 1,
      deposit_status: '',
      deposit_received_date: null,
      deposit_account_label: '',
      deposit_refund_conditions: '',
      exclusivity_granted: null,
      exclusivity_expiry_date: null,
      key_negotiation_changes: '',
      properties: [{ property: { id: 'property-1' } }],
    }),
    sponsors: query([]),
    brokers: query([]),
    funds: query([]),
    properties: query([]),
    assignees: query([{ id: 1, username: 'staff' }]),
    update: { mutate: vi.fn(), isPending: false },
  };
});

vi.mock('@/lib/api/deals', () => ({
  useDeal: () => hooks.deal,
  useSponsors: () => hooks.sponsors,
  useBrokers: () => hooks.brokers,
  useFunds: () => hooks.funds,
  useProperties: () => hooks.properties,
  useDealAssignees: () => hooks.assignees,
  useUpdateDeal: () => hooks.update,
}));

function renderPage() {
  return render(
    <AuthContext.Provider
      value={{
        user: { username: 'staff', email: 'staff@example.com', is_staff: true },
        isAuthenticated: true,
        isLoading: false,
        error: null,
        login: vi.fn(),
        logout: vi.fn(),
      }}
    >
      <MemoryRouter initialEntries={['/deals/deal-1/edit']}>
        <Routes>
          <Route path="/deals/:id/edit" element={<DealEditPage />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('DealEditPage reference data states', () => {
  beforeEach(() => {
    for (const query of [
      hooks.deal,
      hooks.sponsors,
      hooks.brokers,
      hooks.funds,
      hooks.properties,
      hooks.assignees,
    ]) {
      query.isLoading = false;
      query.isError = false;
      query.refetch.mockReset();
    }
  });

  it('does not present missing reference data as an empty relationship', async () => {
    const user = userEvent.setup();
    hooks.properties.isError = true;
    renderPage();

    expect(screen.getByText('Deal relationships unavailable')).toBeInTheDocument();
    expect(screen.queryByText('No property attached yet.')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(hooks.properties.refetch).toHaveBeenCalledOnce();
  });

  it('waits for relationship data before rendering the form', () => {
    hooks.sponsors.isLoading = true;
    renderPage();

    expect(screen.getByText('Loading deal relationships…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save/i })).not.toBeInTheDocument();
  });
});
