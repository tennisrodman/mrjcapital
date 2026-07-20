import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DebtMetrics } from './DebtMetrics';

describe('DebtMetrics', () => {
  it('renders percentage, multiple, and quick-score metrics accessibly', () => {
    render(
      <DebtMetrics
        metrics={{
          ltv_as_is: '0.6500',
          ltv_stabilized: '0.5417',
          ltc: '0.8125',
          dscr: '1.4286',
          debt_yield: '0.1538',
          quick_score: 100,
        }}
      />,
    );

    expect(screen.getByRole('region', { name: 'Calculated debt metrics' })).toBeInTheDocument();
    expect(screen.getByText('65.0%')).toBeInTheDocument();
    expect(screen.getByText('1.4286x')).toBeInTheDocument();
    expect(screen.getByText('100 / 100')).toBeInTheDocument();
    expect(screen.getByText('Heuristic, not a credit decision')).toBeInTheDocument();
  });

  it('labels an empty screen as incomplete instead of a failing score', () => {
    render(
      <DebtMetrics
        metrics={{
          ltv_as_is: null,
          ltv_stabilized: null,
          ltc: null,
          dscr: null,
          debt_yield: null,
          quick_score: 0,
        }}
      />,
    );

    expect(screen.getByText('Needs more inputs')).toBeInTheDocument();
    expect(screen.queryByText('0 / 100')).not.toBeInTheDocument();
  });
});
