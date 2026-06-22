import type { SelectOption } from '@/components/ui/select-native';
import {
  INVESTMENT_TYPE_LABELS,
  PROPERTY_TYPE_LABELS,
  RELATIONSHIP_RATING_LABELS,
  SOURCE_CHANNEL_LABELS,
} from '@/lib/dealChoices';

function toOptions(labels: Record<string, string>): SelectOption[] {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

export const INVESTMENT_TYPE_OPTIONS = toOptions(INVESTMENT_TYPE_LABELS);
export const SOURCE_CHANNEL_OPTIONS = toOptions(SOURCE_CHANNEL_LABELS);
export const PROPERTY_TYPE_OPTIONS = toOptions(PROPERTY_TYPE_LABELS);
export const RELATIONSHIP_RATING_OPTIONS = toOptions(RELATIONSHIP_RATING_LABELS);

export const SPONSOR_ENTITY_TYPE_OPTIONS: SelectOption[] = [
  { value: 'llc', label: 'LLC' },
  { value: 'lp', label: 'LP' },
  { value: 'corp', label: 'Corporation' },
  { value: 'trust', label: 'Trust' },
  { value: 'individual', label: 'Individual' },
];

export const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS',
  'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY',
  'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV',
  'WI', 'WY', 'DC',
];

export const STATE_OPTIONS: SelectOption[] = US_STATES.map((code) => ({ value: code, label: code }));
