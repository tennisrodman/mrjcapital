import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import DealCreatePage from './DealCreatePage';

const hooks = vi.hoisted(() => ({ create: vi.fn(), mutate: vi.fn() }));
vi.mock('@/lib/api/deals', () => ({
  useSponsors: () => ({ data: [], isLoading: false }),
  useBrokers: () => ({ data: [], isLoading: false }),
  useFunds: () => ({ data: [], isLoading: false }),
  useProperties: () => ({ data: [], isLoading: false }),
  useCreateDeal: hooks.create,
}));

describe('DealCreatePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hooks.create.mockReturnValue({ mutate: hooks.mutate, isPending: false });
  });

  it('shows an alert when visible validation errors block submission', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <DealCreatePage />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Create deal' }));

    const message = screen.getByText('Please fix the highlighted fields before creating the deal.');
    expect(message.closest('[role="alert"]')).toBeVisible();
    expect(hooks.mutate).not.toHaveBeenCalled();
  });
});
