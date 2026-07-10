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
});
