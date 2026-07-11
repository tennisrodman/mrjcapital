import { describe, expect, it } from 'vitest';

import {
  buildDealUpdatePayload,
  type EditDealForm,
} from '@/components/deals/form/editPayload';

const values: EditDealForm = {
  name: 'Stale cached name',
  investment_type: 'whole_loan_bridge',
  requested_amount: '1000000.00',
  purpose: 'Edited purpose',
  profile: 'Stale cached profile',
  estimated_value: '',
  renovation_budget: '250000.00',
  description: 'Stale cached description',
  source_channel: 'direct',
  source_date: '2026-07-10',
  fund_id: '',
};

describe('buildDealUpdatePayload', () => {
  it('sends only dirty fields so cached values cannot overwrite concurrent updates', () => {
    expect(buildDealUpdatePayload(values, { purpose: true }, {
      fundLocked: false,
      propertiesChanged: false,
      propertyIds: ['property-1'],
    })).toEqual({ purpose: 'Edited purpose' });
  });

  it('preserves explicit nullable clears and ordered property changes', () => {
    expect(buildDealUpdatePayload(values, {
      estimated_value: true,
      renovation_budget: true,
    }, {
      fundLocked: true,
      propertiesChanged: true,
      propertyIds: ['property-2', 'property-1'],
    })).toEqual({
      estimated_value: null,
      renovation_budget: '250000.00',
      property_ids: ['property-2', 'property-1'],
    });
  });
});
