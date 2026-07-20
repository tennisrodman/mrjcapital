import type { UpdateDealPayload } from '@/lib/api/deals';

export interface EditDealForm {
  name: string;
  investment_type: string;
  requested_amount: string;
  purpose: string;
  profile: string;
  estimated_value: string;
  renovation_budget: string;
  description: string;
  source_channel: string;
  source_date: string;
  sponsor_id: string;
  broker_id: string;
  fund_id: string;
  assigned_analyst_id: string;
  deposit_status: string;
  deposit_received_date: string;
  deposit_account_label: string;
  deposit_refund_conditions: string;
  exclusivity_granted: string;
  exclusivity_expiry_date: string;
  key_negotiation_changes: string;
}

type EditDirtyFields = Partial<Record<keyof EditDealForm, boolean>>;

export function buildDealUpdatePayload(
  values: EditDealForm,
  dirtyFields: EditDirtyFields,
  options: {
    sponsorEditable: boolean;
    brokerEditable: boolean;
    fundEditable: boolean;
    analystEditable: boolean;
    propertiesChanged: boolean;
    propertyIds: string[];
  },
): UpdateDealPayload {
  const payload: UpdateDealPayload = {};
  if (dirtyFields.name) payload.name = values.name;
  if (dirtyFields.investment_type) {
    payload.investment_type = values.investment_type as UpdateDealPayload['investment_type'];
  }
  if (dirtyFields.requested_amount) payload.requested_amount = values.requested_amount.trim();
  if (dirtyFields.purpose) {
    payload.purpose = values.purpose.trim() as UpdateDealPayload['purpose'];
  }
  if (dirtyFields.profile) {
    payload.profile = values.profile.trim() as UpdateDealPayload['profile'];
  }
  if (dirtyFields.estimated_value) payload.estimated_value = values.estimated_value.trim() || null;
  if (dirtyFields.renovation_budget) {
    payload.renovation_budget = values.renovation_budget.trim() || null;
  }
  if (dirtyFields.description) payload.description = values.description.trim();
  if (dirtyFields.source_channel) {
    payload.source_channel = values.source_channel as UpdateDealPayload['source_channel'];
  }
  if (dirtyFields.source_date) payload.source_date = values.source_date;
  if (options.sponsorEditable && dirtyFields.sponsor_id) payload.sponsor = values.sponsor_id || null;
  if (options.brokerEditable && dirtyFields.broker_id) payload.broker = values.broker_id || null;
  if (options.fundEditable && dirtyFields.fund_id) payload.fund = values.fund_id || null;
  if (options.analystEditable && dirtyFields.assigned_analyst_id) {
    payload.assigned_analyst = values.assigned_analyst_id ? Number(values.assigned_analyst_id) : null;
  }
  if (dirtyFields.deposit_status) payload.deposit_status = values.deposit_status as UpdateDealPayload['deposit_status'];
  if (dirtyFields.deposit_received_date) payload.deposit_received_date = values.deposit_received_date || null;
  if (dirtyFields.deposit_account_label) payload.deposit_account_label = values.deposit_account_label.trim();
  if (dirtyFields.deposit_refund_conditions) payload.deposit_refund_conditions = values.deposit_refund_conditions.trim();
  if (dirtyFields.exclusivity_granted) {
    payload.exclusivity_granted = values.exclusivity_granted === '' ? null : values.exclusivity_granted === 'yes';
  }
  if (dirtyFields.exclusivity_expiry_date) payload.exclusivity_expiry_date = values.exclusivity_expiry_date || null;
  if (dirtyFields.key_negotiation_changes) payload.key_negotiation_changes = values.key_negotiation_changes.trim();
  if (options.propertiesChanged) payload.property_ids = options.propertyIds;
  return payload;
}
