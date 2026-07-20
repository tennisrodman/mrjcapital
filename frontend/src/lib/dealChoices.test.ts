import { describe, expect, it } from 'vitest';

import {
  DEAL_PROFILE_LABELS,
  DEAL_PURPOSE_LABELS,
  SPONSOR_ENTITY_TYPE_LABELS,
  formatDate,
} from './dealChoices';

describe('formatDate', () => {
  it('preserves API calendar dates west of UTC', () => {
    expect(formatDate('2026-07-16', 'America/Los_Angeles')).toBe('Jul 16, 2026');
  });

  it('still renders timestamps in the requested local time zone', () => {
    expect(formatDate('2026-07-16T00:00:00Z', 'America/Los_Angeles')).toBe('Jul 15, 2026');
  });
});

describe('deal choice labels', () => {
  it('renders stored deal and sponsor codes as human-readable labels', () => {
    expect(DEAL_PURPOSE_LABELS.acquisition).toBe('Acquisition');
    expect(DEAL_PROFILE_LABELS.value_add).toBe('Value-add');
    expect(SPONSOR_ENTITY_TYPE_LABELS.llc).toBe('LLC');
  });
});
