import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SummaryStrip } from './SummaryStrip';

describe('SummaryStrip', () => {
  it('describes active metrics as in-flight work', () => {
    render(
      <SummaryStrip
        summary={{
          active_deals: 4,
          pipeline_value: '8000000.00',
          gross_pipeline_value: '12000000.00',
          average_days_in_current_stage: 2.5,
          by_pipeline_status: [],
          average_stage_duration_days: [],
        }}
        isLoading={false}
      />,
    );

    expect(screen.getByText('In-flight stages only')).toBeInTheDocument();
    expect(screen.queryByText('Excludes dead & exited')).not.toBeInTheDocument();
  });

  it('surfaces a summary-only failure with a retry action', async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    render(<SummaryStrip summary={undefined} isLoading={false} isError onRetry={retry} />);

    expect(screen.getByRole('alert')).toHaveTextContent('Pipeline summary metrics could not be loaded.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
