import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { StageHistoryPanel } from './StageHistoryPanel';

describe('StageHistoryPanel', () => {
  it('distinguishes an audit-history outage from an empty history', async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    render(<StageHistoryPanel events={[]} isLoading={false} isError onRetry={retry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Stage history could not be loaded.');
    expect(screen.queryByText('No stage history recorded yet.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it('makes an overridden stage transition visible in the audit history', () => {
    render(
      <StageHistoryPanel
        isLoading={false}
        events={[{
          id: 'event-1',
          deal: 'deal-1',
          from_status: 'screening',
          to_status: 'quoting',
          entered_at: '2026-07-10T12:00:00Z',
          exited_at: null,
          performed_by: 1,
          performed_by_detail: { id: 1, username: 'staff' },
          reason: 'Committee exception',
          is_override: true,
        }]}
      />,
    );

    expect(screen.getByText('Override')).toBeVisible();
    expect(screen.getByText('Committee exception')).toBeVisible();
  });
});
