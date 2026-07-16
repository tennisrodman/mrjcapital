import type { SelectOption } from '@/components/ui/select-native';
import {
  DEAL_PROFILE_LABELS,
  DEAL_PURPOSE_LABELS,
  INVESTMENT_TYPE_LABELS,
  PROPERTY_TYPE_LABELS,
  RELATIONSHIP_RATING_LABELS,
  SOURCE_CHANNEL_LABELS,
  SPONSOR_ENTITY_TYPE_LABELS,
} from '@/lib/dealChoices';

function toOptions(labels: Record<string, string>): SelectOption[] {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

export const SUPPORTED_DEBT_INVESTMENT_TYPES = new Set([
  'whole_loan_bridge',
  'whole_loan_permanent',
]);

export const INVESTMENT_TYPE_OPTIONS = toOptions(INVESTMENT_TYPE_LABELS).map((option) => ({
  ...option,
  disabled: !SUPPORTED_DEBT_INVESTMENT_TYPES.has(option.value),
  label: SUPPORTED_DEBT_INVESTMENT_TYPES.has(option.value)
    ? option.label
    : `${option.label} — coming later`,
}));
export const SOURCE_CHANNEL_OPTIONS = toOptions(SOURCE_CHANNEL_LABELS);
export const PROPERTY_TYPE_OPTIONS = toOptions(PROPERTY_TYPE_LABELS);
export const RELATIONSHIP_RATING_OPTIONS = toOptions(RELATIONSHIP_RATING_LABELS);

export const DEAL_PURPOSE_OPTIONS = toOptions(DEAL_PURPOSE_LABELS);

export const DEAL_PROFILE_OPTIONS = toOptions(DEAL_PROFILE_LABELS);

export const PROPERTY_ENVIRONMENTAL_STATUS_OPTIONS: SelectOption[] = [
  { value: 'none', label: 'None identified' },
  { value: 'phase_1_clean', label: 'Phase I clean' },
  { value: 'phase_1_rec', label: 'Phase I REC' },
  { value: 'phase_2_required', label: 'Phase II required' },
  { value: 'phase_2_clean', label: 'Phase II clean' },
  { value: 'remediation', label: 'Remediation required' },
];

export const SPONSOR_CONNECTION_OPTIONS: SelectOption[] = [
  { value: 'broker_referral', label: 'Broker referral' },
  { value: 'direct', label: 'Direct' },
  { value: 'repeat', label: 'Repeat relationship' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'conference', label: 'Conference' },
];

export const BROKER_COMMISSION_TYPE_OPTIONS: SelectOption[] = [
  { value: 'percent_of_loan', label: 'Percent of loan' },
  { value: 'flat_fee', label: 'Flat fee' },
  { value: 'percent_of_equity', label: 'Percent of equity' },
  { value: 'referral_fee', label: 'Referral fee' },
];

export const SPONSOR_ENTITY_TYPE_OPTIONS = toOptions(SPONSOR_ENTITY_TYPE_LABELS);

export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS',
  'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY',
  'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV',
  'WI', 'WY', 'DC',
];

export const STATE_OPTIONS: SelectOption[] = US_STATES.map((code) => ({ value: code, label: code }));
