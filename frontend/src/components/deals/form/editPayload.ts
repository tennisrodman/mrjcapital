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
  fund_id: string;
}

type EditDirtyFields = Partial<Record<keyof EditDealForm, boolean>>;

export function buildDealUpdatePayload(
  values: EditDealForm,
  dirtyFields: EditDirtyFields,
  options: {
    fundLocked: boolean;
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
  if (dirtyFields.purpose) payload.purpose = values.purpose.trim();
  if (dirtyFields.profile) payload.profile = values.profile.trim();
  if (dirtyFields.estimated_value) payload.estimated_value = values.estimated_value.trim() || null;
  if (dirtyFields.renovation_budget) {
    payload.renovation_budget = values.renovation_budget.trim() || null;
  }
  if (dirtyFields.description) payload.description = values.description.trim();
  if (dirtyFields.source_channel) {
    payload.source_channel = values.source_channel as UpdateDealPayload['source_channel'];
  }
  if (dirtyFields.source_date) payload.source_date = values.source_date;
  if (!options.fundLocked && dirtyFields.fund_id) payload.fund = values.fund_id || null;
  if (options.propertiesChanged) payload.property_ids = options.propertyIds;
  return payload;
}
