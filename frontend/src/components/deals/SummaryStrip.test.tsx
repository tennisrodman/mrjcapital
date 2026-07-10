import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SummaryStrip } from './SummaryStrip';

describe('SummaryStrip', () => {
  it('surfaces a summary-only failure with a retry action', async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    render(<SummaryStrip summary={undefined} isLoading={false} isError onRetry={retry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Pipeline summary metrics could not be loaded.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
