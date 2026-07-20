import { describe, expect, it } from 'vitest';

import {
  buildDealUpdatePayload,
  type EditDealForm,
} from '@/components/deals/form/editPayload';

const values: EditDealForm = {
  name: 'Stale cached name',
  investment_type: 'whole_loan_bridge',
  requested_amount: '1000000.00',
  purpose: 'refinance',
  profile: 'stabilized',
  estimated_value: '',
  renovation_budget: '250000.00',
  description: 'Stale cached description',
  source_channel: 'direct',
  source_date: '2026-07-10',
  sponsor_id: '',
  broker_id: '',
  fund_id: '',
  assigned_analyst_id: '',
  deposit_status: '',
  deposit_received_date: '',
  deposit_account_label: '',
  deposit_refund_conditions: '',
  exclusivity_granted: '',
  exclusivity_expiry_date: '',
  key_negotiation_changes: '',
};

describe('buildDealUpdatePayload', () => {
  it('sends only dirty fields so cached values cannot overwrite concurrent updates', () => {
    expect(buildDealUpdatePayload(values, { purpose: true }, {
      sponsorEditable: true,
      brokerEditable: true,
      fundEditable: true,
      analystEditable: true,
      propertiesChanged: false,
      propertyIds: ['property-1'],
    })).toEqual({ purpose: 'refinance' });
  });

  it('preserves explicit nullable clears and ordered property changes', () => {
    expect(buildDealUpdatePayload(values, {
      estimated_value: true,
      renovation_budget: true,
    }, {
      sponsorEditable: false,
      brokerEditable: false,
      fundEditable: false,
      analystEditable: false,
      propertiesChanged: true,
      propertyIds: ['property-2', 'property-1'],
    })).toEqual({
      estimated_value: null,
      renovation_budget: '250000.00',
      property_ids: ['property-2', 'property-1'],
    });
  });
});
