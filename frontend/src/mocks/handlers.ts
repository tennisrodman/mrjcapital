// In-memory mock API. Routes path + method to fixture data and mirrors the
// backend's transition rules and nested-write create contract closely enough to
// exercise every view. State lives for the page session and resets on reload.

import { ApiError } from '@/lib/apiError';
import { isOptionalHttpUrl } from '@/lib/formValidation';
import { calculateDebtMetrics, screeningIsComplete } from '@/components/deals/screening/calculations';
import type {
  ActivityLogEntry,
  Broker,
  Deal,
  DealDocument,
  DealNote,
  DealPropertySummary,
  DealStageEvent,
  Fund,
  InvestmentType,
  PipelineStatus,
  Property,
  Sponsor,
  SyndicationStatus,
} from '@/types/deal';
import type {
  CreateScreeningAssessmentPayload,
  FinalScreeningDecision,
  ScreeningAssessment,
} from '@/types/screening';
import type { Contact, DealContact, DealContactRole } from '@/types/contact';
import {
  ACTIVITY,
  BROKERS,
  buildInitialDeals,
  DOCUMENTS,
  FUNDS,
  MOCK_USER,
  PROPERTIES,
  SPONSORS,
} from './fixtures';
import { PIPELINE_TRANSITIONS } from './pipeline';
import { handleQuotesRequest, getCurrentQuote, documentIsExecutedQuoteEvidence } from './quotes';
import {
  documentIsClosingLinked,
  closingReadinessBlockers,
  handleClosingRequest,
  resolveClosingDealId,
} from './closing';

const deals = buildInitialDeals();
const sponsors = [...SPONSORS];
const brokers = [...BROKERS];
const funds = [...FUNDS];
const properties = [...PROPERTIES];
const documents = [...DOCUMENTS];
const activity = [...ACTIVITY];
const notes: DealNote[] = [];
const screeningAssessments: ScreeningAssessment[] = [];
const contacts: Contact[] = [];
const dealContacts: DealContact[] = [];

for (const deal of deals) {
  const partyLinks: Array<{
    id: string;
    fullName: string;
    companyName: string;
    email: string;
    phone: string;
    role: DealContactRole;
  }> = [];
  if (deal.sponsor_detail) {
    partyLinks.push({
      id: `contact-sponsor-${deal.sponsor_detail.id}`,
      fullName: deal.sponsor_detail.primary_contact_name,
      companyName: deal.sponsor_detail.entity_name,
      email: deal.sponsor_detail.primary_contact_email,
      phone: deal.sponsor_detail.primary_contact_phone,
      role: 'sponsor_contact',
    });
  }
  if (deal.broker_detail) {
    partyLinks.push({
      id: `contact-broker-${deal.broker_detail.id}`,
      fullName: deal.broker_detail.contact_name,
      companyName: deal.broker_detail.company_name,
      email: deal.broker_detail.email,
      phone: deal.broker_detail.phone,
      role: 'broker_contact',
    });
  }
  for (const party of partyLinks) {
    let contact = contacts.find((row) => row.id === party.id);
    if (!contact) {
      contact = {
        id: party.id,
        full_name: party.fullName,
        title: '',
        company_name: party.companyName,
        email: party.email.toLowerCase(),
        phone: party.phone,
        details: {},
        created_at: deal.created_at,
        updated_at: deal.updated_at,
      };
      contacts.push(contact);
    }
    dealContacts.push({
      id: `deal-contact-${deal.id}-${party.role}`,
      deal: deal.id,
      contact: contact.id,
      contact_detail: contact,
      role: party.role,
      is_primary: true,
      notes: '',
      created_at: deal.created_at,
      updated_at: deal.updated_at,
    });
  }
}
const stageEvents: DealStageEvent[] = deals.flatMap((deal) => {
  const logs = activity
    .filter((entry) => entry.deal === deal.id && entry.metadata.field === 'pipeline_status')
    .sort((a, b) => a.performed_at.localeCompare(b.performed_at));
  let fromStatus: PipelineStatus | null = null;
  let currentStatus: PipelineStatus = logs.length
    ? (logs[0].old_value as PipelineStatus)
    : deal.pipeline_status;
  let enteredAt = deal.created_at;
  let performedBy: number | null = null;
  let performedByDetail: DealStageEvent['performed_by_detail'] = null;
  let reason = '';
  let sequence = 0;
  const events: DealStageEvent[] = [];

  for (const log of logs) {
    events.push({
      id: `stage-seed-${deal.id}-${sequence++}`,
      deal: deal.id,
      from_status: fromStatus,
      to_status: currentStatus,
      entered_at: enteredAt,
      exited_at: log.performed_at,
      performed_by: performedBy,
      performed_by_detail: performedByDetail,
      reason,
      is_override: false,
    });
    fromStatus = currentStatus;
    currentStatus = log.new_value as PipelineStatus;
    enteredAt = log.performed_at;
    performedBy = log.performed_by;
    performedByDetail = log.performed_by
      ? { id: log.performed_by, username: MOCK_USER.username }
      : null;
    reason = log.reason;
  }

  if (currentStatus !== deal.pipeline_status) {
    events.push({
      id: `stage-seed-${deal.id}-${sequence++}`,
      deal: deal.id,
      from_status: fromStatus,
      to_status: currentStatus,
      entered_at: enteredAt,
      exited_at: deal.updated_at,
      performed_by: performedBy,
      performed_by_detail: performedByDetail,
      reason,
      is_override: false,
    });
    fromStatus = currentStatus;
    currentStatus = deal.pipeline_status;
    enteredAt = deal.updated_at;
    performedBy = null;
    performedByDetail = null;
    reason = '';
  }

  deal.current_stage_entered_at = enteredAt;
  deal.days_in_current_stage = Math.max(
    0,
    Math.floor((Date.now() - new Date(enteredAt).getTime()) / 86_400_000),
  );
  events.push({
    id: `stage-seed-${deal.id}-${sequence}`,
    deal: deal.id,
    from_status: fromStatus,
    to_status: currentStatus,
    entered_at: enteredAt,
    exited_at: null,
    performed_by: performedBy,
    performed_by_detail: performedByDetail,
    reason,
    is_override: false,
  });
  return events;
});

const SYNDICATION_TRANSITIONS: Record<SyndicationStatus, SyndicationStatus[]> = {
  not_started: ['raising'],
  raising: ['fully_subscribed', 'cancelled'],
  fully_subscribed: ['closed', 'cancelled'],
  closed: [],
  cancelled: [],
};

const SYNDICATION_START_STAGES: PipelineStatus[] = ['quoting', 'negotiating', 'signed', 'closing'];
const SYNDICATION_TERMINAL_STAGES: PipelineStatus[] = ['dead', 'exited'];
const SUPPORTED_DEBT_INVESTMENT_TYPES: InvestmentType[] = [
  'whole_loan_bridge',
  'whole_loan_permanent',
];
const DEAL_PURPOSES: Deal['purpose'][] = [
  '',
  'acquisition',
  'refinance',
  'construction',
  'recapitalization',
];
const DEAL_PROFILES: Deal['profile'][] = ['', 'value_add', 'construction', 'stabilized'];
const SOURCE_CHANNELS: Deal['source_channel'][] = [
  'broker',
  'direct',
  'referral',
  'repeat_sponsor',
  'internal_prospecting',
];
const SPONSOR_ENTITY_TYPES: Sponsor['entity_type'][] = ['llc', 'lp', 'corp', 'trust', 'individual'];
const RELATIONSHIP_RATINGS: Sponsor['relationship_rating'][] = [
  'new',
  'developing',
  'established',
  'strategic',
];
const PROPERTY_TYPES: Property['property_type'][] = [
  'multifamily',
  'office',
  'retail',
  'industrial',
  'hotel',
  'self_storage',
  'land',
  'mixed_use',
  'data_center',
  'condo',
  'master_planned_residential',
  'other',
];
const POSITIVE_INTEGER_MAX = 2_147_483_647;
const POSITIVE_BIG_INTEGER_MAX = 9_223_372_036_854_775_807n;
const SPONSOR_PROMOTED_FACT_FIELDS = [
  'website',
  'years_experience',
  'completed_projects',
  'bankruptcy_history',
] as const;
const PROPERTY_PROMOTED_FACT_FIELDS = [
  'subtype',
  'units',
  'rentable_square_feet',
  'year_built',
  'year_renovated',
  'county',
] as const;
const DEAL_AUDIT_FIELDS = [
  'name',
  'investment_type',
  'source_channel',
  'source_date',
  'requested_amount',
  'purpose',
  'profile',
  'estimated_value',
  'renovation_budget',
  'description',
  'sponsor',
  'broker',
  'fund',
] as const;

let idCounter = 1000;
const newId = (prefix: string) => `${prefix}-${idCounter++}`;
const nowIso = () => new Date().toISOString();

function badRequest(field: string, message: string): never {
  throw new ApiError(message, 400, { [field]: [message] });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function requireString(data: Record<string, unknown>, field: string, errorField = field): string {
  const value = stringValue(data[field]);
  if (!value) badRequest(errorField, `${field} is required.`);
  return value;
}

function requireStringMax(
  data: Record<string, unknown>,
  field: string,
  maxLength: number,
  errorField = field,
): string {
  const value = requireString(data, field, errorField);
  if (value.length > maxLength) {
    badRequest(errorField, `Ensure this field has no more than ${maxLength} characters.`);
  }
  return value;
}

function requireEmail(data: Record<string, unknown>, field: string, errorField = field): string {
  const value = requireStringMax(data, field, 254, errorField);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) badRequest(errorField, `${field} must be a valid email.`);
  return value;
}

function nullableMoney(data: Record<string, unknown>, field: string): string | null {
  const raw = data[field];
  if (raw === null || raw === undefined || raw === '') return null;
  return moneyValue(raw, field, false);
}

function moneyValue(raw: unknown, field: string, positive: boolean): string {
  const value = String(raw).trim();
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) badRequest(field, 'Enter a valid amount with no more than 2 decimal places.');
  const integer = match[1].replace(/^0+(?=\d)/, '');
  const fraction = (match[2] ?? '').padEnd(2, '0');
  if (integer.length + fraction.length > 16) {
    badRequest(field, 'Ensure that there are no more than 16 digits in total.');
  }
  if (positive && Number(`${integer}.${fraction}`) <= 0) {
    badRequest(field, 'Ensure this value is greater than 0.');
  }
  return `${integer}.${fraction}`;
}

function requiredChoice<T extends string>(
  data: Record<string, unknown>,
  field: string,
  choices: readonly T[],
): T {
  const value = requireString(data, field);
  if (!choices.includes(value as T)) badRequest(field, `Unsupported value: ${value}.`);
  return value as T;
}

function nullableWholeNumber(
  data: Record<string, unknown>,
  field: string,
  options: { min?: number; max?: number | bigint } = {},
): number | null {
  const raw = data[field];
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' && !raw.trim()) {
    badRequest(field, 'Enter a valid non-negative whole number.');
  }
  const value = Number(raw);
  const min = options.min ?? 0;
  if (!Number.isInteger(value) || value < min) badRequest(field, 'Enter a valid non-negative whole number.');
  if (options.max !== undefined) {
    const rawInteger = String(raw).trim().replace(/\.0+$/, '');
    const exceedsMaximum = typeof options.max === 'bigint' && /^[+-]?\d+$/.test(rawInteger)
      ? BigInt(rawInteger) > options.max
      : value > Number(options.max);
    if (exceedsMaximum) {
      badRequest(field, `Ensure this value is less than or equal to ${options.max}.`);
    }
  }
  return value;
}

function nullableBoolean(data: Record<string, unknown>, field: string): boolean | null {
  const raw = data[field];
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'boolean') badRequest(field, 'Must be a valid boolean.');
  return raw;
}

function deriveCategory(type: InvestmentType): Deal['investment_category'] {
  if (type === 'whole_loan_bridge' || type === 'whole_loan_permanent') return 'debt';
  if (type === 'mezzanine' || type === 'preferred_equity') return 'hybrid';
  return 'equity';
}

function paginate<T>(items: T[], query: URLSearchParams) {
  const page = Number(query.get('page') ?? '1') || 1;
  const pageSize = 50;
  const start = (page - 1) * pageSize;
  const slice = items.slice(start, start + pageSize);
  return {
    count: items.length,
    next: start + pageSize < items.length ? `?page=${page + 1}` : null,
    previous: page > 1 ? `?page=${page - 1}` : null,
    results: slice,
  };
}

function filterDeals(query: URLSearchParams): Deal[] {
  let result = [...deals];
  const search = query.get('search');
  if (search) result = result.filter((d) => d.name.toLowerCase().includes(search.toLowerCase()));
  for (const field of ['pipeline_status', 'syndication_status', 'investment_type', 'source_channel'] as const) {
    const value = query.get(field);
    if (value) result = result.filter((d) => d[field] === value);
  }
  const analyst = query.get('assigned_analyst');
  if (analyst === 'me') result = result.filter((d) => d.assigned_analyst === MOCK_USER_ID);
  else if (analyst) result = result.filter((d) => String(d.assigned_analyst) === analyst);
  return result;
}

const MOCK_USER_ID = 1;

function buildSummary(query: URLSearchParams) {
  const filtered = filterDeals(query);
  const inactiveStages: PipelineStatus[] = ['dead', 'closed', 'servicing', 'exited'];
  const active = filtered.filter((d) => !inactiveStages.includes(d.pipeline_status));
  const sum = (list: Deal[]) =>
    list.reduce((total, d) => total + (Number(d.requested_amount) || 0), 0).toFixed(2);
  const groups = new Map<PipelineStatus, Deal[]>();
  for (const deal of filtered) {
    groups.set(deal.pipeline_status, [...(groups.get(deal.pipeline_status) ?? []), deal]);
  }
  const averageDays = (rows: Deal[]) =>
    rows.length ? rows.reduce((total, deal) => total + deal.days_in_current_stage, 0) / rows.length : 0;
  return {
    active_deals: active.length,
    pipeline_value: sum(active),
    gross_pipeline_value: sum(filtered),
    average_days_in_current_stage: Number(averageDays(filtered).toFixed(2)),
    by_pipeline_status: [...groups.entries()].map(([pipeline_status, rows]) => ({
      pipeline_status,
      count: rows.length,
      requested_amount: sum(rows),
      average_days_in_current_stage: Number(averageDays(rows).toFixed(2)),
    })),
    average_stage_duration_days: [],
  };
}

let dealPropertyPk = 5000;

function resolveSponsor(input: unknown): Sponsor | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'string') {
    const existing = sponsors.find((s) => s.id === input);
    if (!existing) badRequest('sponsor', 'Selected sponsor no longer exists.');
    return existing!;
  }
  if (!isObject(input)) badRequest('sponsor', 'Expected an existing sponsor id, an object, or null.');
  const website = 'website' in input ? stringFieldMax(input, 'website', 200) : '';
  if (website && !isOptionalHttpUrl(website)) {
    badRequest('sponsor', 'Enter a valid URL.');
  }
  const created: Sponsor = {
    id: newId('sp'),
    entity_name: requireStringMax(input, 'entity_name', 255, 'sponsor'),
    entity_type: requiredChoice(input, 'entity_type', SPONSOR_ENTITY_TYPES),
    primary_contact_name: requireStringMax(input, 'primary_contact_name', 255, 'sponsor'),
    primary_contact_email: requireEmail(input, 'primary_contact_email', 'sponsor'),
    primary_contact_phone: 'primary_contact_phone' in input
      ? stringFieldMax(input, 'primary_contact_phone', 40)
      : '',
    relationship_rating: input.relationship_rating === undefined
      ? 'new'
      : requiredChoice(input, 'relationship_rating', RELATIONSHIP_RATINGS),
    website,
    years_experience: nullableWholeNumber(input, 'years_experience', { max: 200 }),
    completed_projects: nullableWholeNumber(input, 'completed_projects', { max: POSITIVE_INTEGER_MAX }),
    bankruptcy_history: nullableBoolean(input, 'bankruptcy_history'),
    business_address: stringValue(input.business_address),
    total_units_owned: nullableWholeNumber(input, 'total_units_owned', { max: POSITIVE_INTEGER_MAX }),
    total_sf_managed: nullableWholeNumber(input, 'total_sf_managed', { max: POSITIVE_BIG_INTEGER_MAX }),
    assets_under_management: nullableMoney(input, 'assets_under_management'),
    track_record: [],
    connection_source: '',
    details: {},
  };
  sponsors.push(created);
  return created;
}

function resolveBroker(input: unknown): Broker | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'string') {
    const existing = brokers.find((b) => b.id === input);
    if (!existing) badRequest('broker', 'Selected broker no longer exists.');
    return existing!;
  }
  if (!isObject(input)) badRequest('broker', 'Expected an existing broker id, an object, or null.');
  const companyName = requireString(input, 'company_name', 'broker');
  const created: Broker = {
    id: newId('bk'),
    company_name: companyName,
    contact_name: stringValue(input.contact_name) || companyName,
    email: requireEmail(input, 'email', 'broker'),
    phone: stringValue(input.phone),
    status: 'active',
    default_commission_rate: nullableMoney(input, 'default_commission_rate'),
    commission_type: '',
    preferred_deal_types: [],
    geographic_focus: [],
    details: {},
  };
  brokers.push(created);
  return created;
}

function resolveFund(input: unknown): Fund | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input !== 'string') badRequest('fund', 'Expected an existing fund id or null.');
  const existing = funds.find((f) => f.id === input);
  if (!existing) badRequest('fund', 'Selected fund no longer exists.');
  return existing!;
}

function resolveExistingSponsor(input: unknown): Sponsor | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input !== 'string') badRequest('sponsor', 'Expected an existing sponsor id or null.');
  return resolveSponsor(input);
}

function resolveExistingBroker(input: unknown): Broker | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input !== 'string') badRequest('broker', 'Expected an existing broker id or null.');
  return resolveBroker(input);
}

function findSponsor(id: string): Sponsor {
  const sponsor = sponsors.find((row) => row.id === id);
  if (!sponsor) throw new ApiError('Not found.', 404, { detail: 'Not found.' });
  return sponsor;
}

function deleteSponsor(sponsor: Sponsor): Record<string, never> {
  if (deals.some((deal) => deal.sponsor === sponsor.id)) {
    const message = 'This sponsor is linked to one or more deals and cannot be deleted.';
    throw new ApiError(message, 400, { detail: message });
  }
  sponsors.splice(sponsors.indexOf(sponsor), 1);
  return {};
}

function updateSponsor(
  sponsor: Sponsor,
  body: Record<string, unknown>,
  partial: boolean,
): Sponsor {
  const candidate = clone(sponsor);
  if (!partial) {
    for (const field of ['entity_name', 'entity_type', 'primary_contact_name', 'primary_contact_email']) {
      if (!(field in body)) badRequest(field, 'This field is required.');
    }
  }
  if ('entity_name' in body) candidate.entity_name = requireString(body, 'entity_name');
  if ('entity_type' in body) {
    candidate.entity_type = requiredChoice(body, 'entity_type', SPONSOR_ENTITY_TYPES);
  }
  if ('primary_contact_name' in body) {
    candidate.primary_contact_name = requireString(body, 'primary_contact_name');
  }
  if ('primary_contact_email' in body) {
    candidate.primary_contact_email = requireEmail(body, 'primary_contact_email');
  }
  if ('primary_contact_phone' in body) {
    candidate.primary_contact_phone = stringField(body, 'primary_contact_phone');
  }
  if ('relationship_rating' in body) {
    candidate.relationship_rating = requiredChoice(body, 'relationship_rating', RELATIONSHIP_RATINGS);
  }
  if ('website' in body) {
    const website = stringFieldMax(body, 'website', 200);
    if (website && !isOptionalHttpUrl(website)) {
      badRequest('website', 'Enter a valid URL.');
    }
    candidate.website = website;
  }
  if ('years_experience' in body) {
    candidate.years_experience = nullableWholeNumber(body, 'years_experience', { max: 200 });
  }
  if ('completed_projects' in body) {
    candidate.completed_projects = nullableWholeNumber(body, 'completed_projects', {
      max: POSITIVE_INTEGER_MAX,
    });
  }
  if ('bankruptcy_history' in body) {
    candidate.bankruptcy_history = nullableBoolean(body, 'bankruptcy_history');
  }
  logEntityFactUpdates(
    sponsor,
    candidate,
    body,
    SPONSOR_PROMOTED_FACT_FIELDS,
    'Sponsor',
    deals.filter((deal) => deal.sponsor === sponsor.id).map((deal) => deal.id),
  );
  Object.assign(sponsor, candidate);
  return sponsor;
}

function resolveProperty(input: unknown): Property {
  if (typeof input === 'string') {
    const existing = properties.find((p) => p.id === input);
    if (!existing) badRequest('properties', 'Selected property no longer exists.');
    return existing!;
  }
  if (!isObject(input)) badRequest('properties', 'Expected an existing property id or an object.');
  const address = requireStringMax(input, 'address', 255, 'properties');
  const city = requireStringMax(input, 'city', 120, 'properties');
  const state = requireString(input, 'state', 'properties').toUpperCase();
  if (state.length > 2) badRequest('properties', 'state must contain no more than 2 characters.');
  const zip = requireStringMax(input, 'zip', 20, 'properties');
  const propertyType = requiredChoice(input, 'property_type', PROPERTY_TYPES);
  const yearBuilt = nullableWholeNumber(input, 'year_built', { min: 1700, max: 2200 });
  const yearRenovated = nullableWholeNumber(input, 'year_renovated', { min: 1700, max: 2200 });
  if (yearBuilt !== null && yearRenovated !== null && yearRenovated < yearBuilt) {
    badRequest('year_renovated', 'Year renovated cannot be earlier than year built.');
  }
  const addressNormalized = normalizePropertyInput(input);
  if (properties.some((property) => property.address_normalized === addressNormalized)) {
    badRequest('properties', 'A property with this normalized address already exists.');
  }
  const created: Property = {
    id: newId('pr'),
    address,
    address_normalized: addressNormalized,
    city,
    state,
    zip,
    property_type: propertyType,
    subtype: 'subtype' in input ? stringFieldMax(input, 'subtype', 120) : '',
    units: nullableWholeNumber(input, 'units', { max: POSITIVE_INTEGER_MAX }),
    rentable_square_feet: nullableWholeNumber(input, 'rentable_square_feet', {
      max: POSITIVE_BIG_INTEGER_MAX,
    }),
    year_built: yearBuilt,
    year_renovated: yearRenovated,
    county: 'county' in input ? stringFieldMax(input, 'county', 120) : '',
    msa: 'msa' in input ? stringFieldMax(input, 'msa', 160) : '',
    number_of_buildings: nullableWholeNumber(input, 'number_of_buildings', { max: POSITIVE_INTEGER_MAX }),
    number_of_stories: nullableWholeNumber(input, 'number_of_stories', { max: POSITIVE_INTEGER_MAX }),
    parking_spaces: nullableWholeNumber(input, 'parking_spaces', { max: POSITIVE_INTEGER_MAX }),
    lot_size_acres: nullableMoney(input, 'lot_size_acres'),
    flood_zone: stringValue(input.flood_zone),
    zoning_designation: stringValue(input.zoning_designation),
    environmental_status: '',
    details: {},
  };
  properties.push(created);
  return created;
}

function findProperty(id: string): Property {
  const property = properties.find((row) => row.id === id);
  if (!property) throw new ApiError('Not found.', 404, { detail: 'Not found.' });
  return property;
}

function deleteProperty(property: Property): Record<string, never> {
  if (deals.some((deal) => deal.properties.some((link) => link.property.id === property.id))) {
    const message = 'This property is linked to one or more deals and cannot be deleted.';
    throw new ApiError(message, 400, { detail: message });
  }
  properties.splice(properties.indexOf(property), 1);
  return {};
}

function updateProperty(
  property: Property,
  body: Record<string, unknown>,
  partial: boolean,
): Property {
  const candidate = clone(property);
  if (!partial) {
    for (const field of ['address', 'city', 'state', 'zip', 'property_type']) {
      if (!(field in body)) badRequest(field, 'This field is required.');
    }
  }
  if ('address' in body) candidate.address = requireString(body, 'address');
  if ('city' in body) candidate.city = requireString(body, 'city');
  if ('state' in body) {
    const state = requireString(body, 'state').toUpperCase();
    if (state.length > 2) badRequest('state', 'Ensure this field has no more than 2 characters.');
    candidate.state = state;
  }
  if ('zip' in body) candidate.zip = requireString(body, 'zip');
  if ('property_type' in body) {
    candidate.property_type = requiredChoice(body, 'property_type', PROPERTY_TYPES);
  }
  if ('subtype' in body) candidate.subtype = stringFieldMax(body, 'subtype', 120);
  if ('units' in body) {
    candidate.units = nullableWholeNumber(body, 'units', { max: POSITIVE_INTEGER_MAX });
  }
  if ('rentable_square_feet' in body) {
    candidate.rentable_square_feet = nullableWholeNumber(body, 'rentable_square_feet', {
      max: POSITIVE_BIG_INTEGER_MAX,
    });
  }
  if ('year_built' in body) {
    candidate.year_built = nullableWholeNumber(body, 'year_built', { min: 1700, max: 2200 });
  }
  if ('year_renovated' in body) {
    candidate.year_renovated = nullableWholeNumber(body, 'year_renovated', { min: 1700, max: 2200 });
  }
  if ('county' in body) candidate.county = stringFieldMax(body, 'county', 120);
  if ('msa' in body) candidate.msa = stringFieldMax(body, 'msa', 160);
  if (
    candidate.year_built !== null
    && candidate.year_renovated !== null
    && candidate.year_renovated < candidate.year_built
  ) {
    badRequest('year_renovated', 'Year renovated cannot be earlier than year built.');
  }
  candidate.address_normalized = normalizePropertyInput(candidate as unknown as Record<string, unknown>);
  if (properties.some((row) => row.id !== property.id && row.address_normalized === candidate.address_normalized)) {
    badRequest('address_normalized', 'A property with this normalized address already exists.');
  }
  logEntityFactUpdates(
    property,
    candidate,
    body,
    PROPERTY_PROMOTED_FACT_FIELDS,
    'Property',
    deals
      .filter((deal) => deal.properties.some((link) => link.property.id === property.id))
      .map((deal) => deal.id),
  );
  Object.assign(property, candidate);
  return property;
}

function normalizePropertyInput(input: Record<string, unknown>): string {
  return [
    stringValue(input.address),
    stringValue(input.city),
    stringValue(input.state).toUpperCase(),
    stringValue(input.zip),
  ].join(' ').toUpperCase();
}

function propertyInputIdentity(input: unknown, field = 'properties'): string {
  if (typeof input === 'string') {
    const existing = properties.find((property) => property.id === input);
    if (!existing) badRequest(field, 'Selected property no longer exists.');
    return `id:${existing.id}`;
  }
  if (field === 'property_ids') badRequest(field, 'Incorrect type. Expected pk value.');
  if (!isObject(input)) badRequest(field, 'Expected an existing property id or an object.');
  return `address:${normalizePropertyInput(input)}`;
}

function validateUniquePropertyInputs(inputs: unknown[], field = 'properties') {
  const seen = new Set<string>();
  inputs.forEach((input, index) => {
    const identity = propertyInputIdentity(input, field);
    if (seen.has(identity)) {
      const message =
        field === 'property_ids'
          ? 'property_ids cannot contain duplicates.'
          : `Property at index ${index} duplicates another property on this deal.`;
      badRequest(field, message);
    }
    seen.add(identity);
  });
}

function toDealProperties(props: Property[]): DealPropertySummary[] {
  return props.map((property, index) => ({
    id: dealPropertyPk++,
    property,
    is_primary: index === 0,
  }));
}

function createDeal(body: Record<string, unknown>): Deal {
  const collectionLengths = {
    sponsors: sponsors.length,
    brokers: brokers.length,
    properties: properties.length,
  };
  try {
    return createDealUnchecked(body);
  } catch (error) {
    sponsors.splice(collectionLengths.sponsors);
    brokers.splice(collectionLengths.brokers);
    properties.splice(collectionLengths.properties);
    throw error;
  }
}

function createDealUnchecked(body: Record<string, unknown>): Deal {
  const name = requireStringMax(body, 'name', 255);
  const investmentType = requiredChoice(body, 'investment_type', SUPPORTED_DEBT_INVESTMENT_TYPES);
  const sourceChannel = requiredChoice(body, 'source_channel', SOURCE_CHANNELS);
  const requestedAmount = moneyValue(body.requested_amount, 'requested_amount', true);
  const sponsor = resolveSponsor(body.sponsor);
  const broker = resolveBroker(body.broker);
  const fund = resolveFund(body.fund);
  if ('properties' in body && 'property_ids' in body) {
    badRequest('properties', 'Use either properties or property_ids, not both.');
  }
  if ('properties' in body && !Array.isArray(body.properties)) {
    badRequest('properties', 'Expected a list of property ids or objects.');
  }
  if ('property_ids' in body && !Array.isArray(body.property_ids)) {
    badRequest('property_ids', 'Expected a list of property ids.');
  }
  const propertyInputs = Array.isArray(body.property_ids)
    ? body.property_ids
    : Array.isArray(body.properties)
      ? body.properties
      : [];
  validateUniquePropertyInputs(propertyInputs, Array.isArray(body.property_ids) ? 'property_ids' : 'properties');
  const resolvedProperties = propertyInputs.map(resolveProperty);

  const deal: Deal = {
    id: newId('deal'),
    name,
    investment_type: investmentType,
    investment_category: deriveCategory(investmentType),
    pipeline_status: 'sourced',
    syndication_status: 'not_started',
    paused_from_status: null,
    sponsor: sponsor?.id ?? null,
    sponsor_detail: sponsor,
    broker: broker?.id ?? null,
    broker_detail: broker,
    assigned_analyst: MOCK_USER_ID,
    assigned_analyst_detail: { id: MOCK_USER_ID, username: MOCK_USER.username },
    fund: fund?.id ?? null,
    fund_detail: fund,
    source_channel: sourceChannel,
    source_date: String(body.source_date ?? nowIso().slice(0, 10)),
    requested_amount: requestedAmount,
    purpose: 'purpose' in body ? requiredChoice(body, 'purpose', DEAL_PURPOSES) : '',
    profile: 'profile' in body ? requiredChoice(body, 'profile', DEAL_PROFILES) : '',
    estimated_value: nullableMoney(body, 'estimated_value'),
    renovation_budget: nullableMoney(body, 'renovation_budget'),
    description: optionalStringField(body, 'description'),
    deposit_status: '',
    deposit_received_date: null,
    deposit_account_label: '',
    deposit_refund_conditions: '',
    exclusivity_granted: null,
    exclusivity_expiry_date: null,
    key_negotiation_changes: '',
    current_stage_entered_at: nowIso(),
    days_in_current_stage: 0,
    details: {},
    properties: toDealProperties(resolvedProperties),
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  deals.unshift(deal);
  stageEvents.unshift({
    id: newId('stage'),
    deal: deal.id,
    from_status: null,
    to_status: 'sourced',
    entered_at: deal.current_stage_entered_at,
    exited_at: null,
    performed_by: MOCK_USER_ID,
    performed_by_detail: { id: MOCK_USER_ID, username: MOCK_USER.username },
    reason: '',
    is_override: false,
  });
  return deal;
}

function updateDeal(deal: Deal, body: Record<string, unknown>): Deal {
  // Deal edits replace relationship/property references rather than mutating
  // their nested records. Preserve those shared store references on rollback.
  const snapshot: Deal = { ...deal };
  try {
    const updated = updateDealUnchecked(deal, body);
    logDealFieldUpdates(updated, snapshot, body);
    return updated;
  } catch (error) {
    Object.assign(deal, snapshot);
    throw error;
  }
}

function updateDealUnchecked(deal: Deal, body: Record<string, unknown>): Deal {
  if ('name' in body) deal.name = requireStringMax(body, 'name', 255);
  if ('investment_type' in body) {
    const investmentType = requiredChoice(body, 'investment_type', SUPPORTED_DEBT_INVESTMENT_TYPES);
    deal.investment_type = investmentType;
    deal.investment_category = deriveCategory(investmentType);
  }
  if ('requested_amount' in body) {
    deal.requested_amount = moneyValue(body.requested_amount, 'requested_amount', true);
  }
  if ('purpose' in body) deal.purpose = requiredChoice(body, 'purpose', DEAL_PURPOSES);
  if ('profile' in body) deal.profile = requiredChoice(body, 'profile', DEAL_PROFILES);
  if ('estimated_value' in body) deal.estimated_value = nullableMoney(body, 'estimated_value');
  if ('renovation_budget' in body) deal.renovation_budget = nullableMoney(body, 'renovation_budget');
  if ('description' in body) deal.description = stringField(body, 'description');
  if ('source_channel' in body) {
    deal.source_channel = requiredChoice(body, 'source_channel', SOURCE_CHANNELS);
  }
  if ('source_date' in body) deal.source_date = requireString(body, 'source_date');
  if ('assigned_analyst' in body) {
    if (!MOCK_USER.is_staff) {
      badRequest('assigned_analyst', 'Only staff may reassign a deal.');
    }
    if (body.assigned_analyst !== null && body.assigned_analyst !== MOCK_USER_ID) {
      badRequest('assigned_analyst', 'Selected analyst is not available.');
    }
    deal.assigned_analyst = body.assigned_analyst as number | null;
    deal.assigned_analyst_detail = deal.assigned_analyst === null
      ? null
      : { id: MOCK_USER_ID, username: MOCK_USER.username };
  }
  if ('deposit_status' in body) {
    deal.deposit_status = requiredChoice(
      body,
      'deposit_status',
      ['', 'pending', 'received', 'applied_to_closing', 'refunded'] as const,
    );
  }
  if ('deposit_received_date' in body) {
    deal.deposit_received_date = body.deposit_received_date
      ? requireString(body, 'deposit_received_date')
      : null;
  }
  if ('deposit_account_label' in body) {
    deal.deposit_account_label = stringFieldMax(body, 'deposit_account_label', 120);
  }
  if ('deposit_refund_conditions' in body) {
    deal.deposit_refund_conditions = stringField(body, 'deposit_refund_conditions');
  }
  if ('exclusivity_granted' in body) {
    if (body.exclusivity_granted !== null && typeof body.exclusivity_granted !== 'boolean') {
      badRequest('exclusivity_granted', 'Must be a valid boolean or null.');
    }
    deal.exclusivity_granted = body.exclusivity_granted as boolean | null;
  }
  if ('exclusivity_expiry_date' in body) {
    deal.exclusivity_expiry_date = body.exclusivity_expiry_date
      ? requireString(body, 'exclusivity_expiry_date')
      : null;
  }
  if ('key_negotiation_changes' in body) {
    deal.key_negotiation_changes = stringField(body, 'key_negotiation_changes');
  }
  if ('sponsor' in body) {
    const sponsor = resolveExistingSponsor(body.sponsor);
    const nextId = sponsor?.id ?? null;
    if (deal.sponsor && nextId !== deal.sponsor && !MOCK_USER.is_staff) {
      badRequest('sponsor', 'Only staff may change an existing relationship.');
    }
    deal.sponsor = nextId;
    deal.sponsor_detail = sponsor;
  }
  if ('broker' in body) {
    const broker = resolveExistingBroker(body.broker);
    const nextId = broker?.id ?? null;
    if (deal.broker && nextId !== deal.broker && !MOCK_USER.is_staff) {
      badRequest('broker', 'Only staff may change an existing relationship.');
    }
    deal.broker = nextId;
    deal.broker_detail = broker;
  }
  if ('fund' in body) {
    const fund = resolveFund(body.fund);
    const nextId = fund?.id ?? null;
    if (deal.fund && nextId !== deal.fund && !MOCK_USER.is_staff) {
      badRequest('fund', 'Only staff may change an existing relationship.');
    }
    deal.fund = nextId;
    deal.fund_detail = fund;
  }
  if (Array.isArray(body.property_ids)) {
    if (body.property_ids.length === 0) badRequest('property_ids', 'property_ids must include at least one property when provided.');
    validateUniquePropertyInputs(body.property_ids, 'property_ids');
    const resolved = body.property_ids.map((id) => {
      if (typeof id !== 'string') badRequest('property_ids', 'Expected a list of property ids.');
      const property = properties.find((p) => p.id === id);
      if (!property) badRequest('property_ids', 'Selected property no longer exists.');
      return property;
    });
    deal.properties = toDealProperties(resolved);
  } else if ('property_ids' in body) {
    badRequest('property_ids', 'Expected a list of property ids.');
  }
  deal.updated_at = nowIso();
  return deal;
}

function stringField(data: Record<string, unknown>, field: string): string {
  if (typeof data[field] !== 'string') badRequest(field, 'Not a valid string.');
  return String(data[field]).trim();
}

function stringFieldMax(data: Record<string, unknown>, field: string, maxLength: number): string {
  const value = stringField(data, field);
  if (value.length > maxLength) {
    badRequest(field, `Ensure this field has no more than ${maxLength} characters.`);
  }
  return value;
}

function optionalStringField(data: Record<string, unknown>, field: string): string {
  return field in data ? stringField(data, field) : '';
}

function canonicalDealField(deal: Deal, field: (typeof DEAL_AUDIT_FIELDS)[number]): string {
  const value = deal[field];
  return value === null || value === undefined ? '' : String(value);
}

function auditDealField(field: (typeof DEAL_AUDIT_FIELDS)[number], value: string): string {
  return field === 'description' && value.length > 500 ? `${value.slice(0, 497)}...` : value;
}

function auditFactValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return String(value).toLowerCase();
  return String(value);
}

function logEntityFactUpdates(
  previous: Sponsor | Property,
  updated: Sponsor | Property,
  body: Record<string, unknown>,
  promotedFields: readonly string[],
  subjectModel: 'Sponsor' | 'Property',
  linkedDealIds: string[],
) {
  const oldValues = previous as unknown as Record<string, unknown>;
  const newValues = updated as unknown as Record<string, unknown>;
  const changes = promotedFields.filter(
    (field) => field in body && oldValues[field] !== newValues[field],
  );
  if (!changes.length) return;
  const contextualDealIds: Array<string | null> = linkedDealIds.length ? linkedDealIds : [null];
  for (const dealId of contextualDealIds) {
    for (const field of changes) {
      activity.unshift({
        id: newId('act'),
        deal: dealId,
        action_type: 'field_updated',
        performed_by: MOCK_USER_ID,
        performed_at: nowIso(),
        ip_address: null,
        description: `${subjectModel} ${field} updated`,
        old_value: auditFactValue(oldValues[field]),
        new_value: auditFactValue(newValues[field]),
        reason: '',
        metadata: { field, subject_model: subjectModel, subject_id: updated.id },
      });
    }
  }
}

function logDealFieldUpdates(
  deal: Deal,
  previous: Deal,
  body: Record<string, unknown>,
) {
  for (const field of DEAL_AUDIT_FIELDS) {
    if (!(field in body)) continue;
    const oldValue = canonicalDealField(previous, field);
    const newValue = canonicalDealField(deal, field);
    if (oldValue === newValue) continue;
    activity.unshift({
      id: newId('act'),
      deal: deal.id,
      action_type: 'field_updated',
      performed_by: MOCK_USER_ID,
      performed_at: nowIso(),
      ip_address: null,
      description: `${field} updated`,
      old_value: auditDealField(field, oldValue),
      new_value: auditDealField(field, newValue),
      reason: '',
      metadata: { field, subject_model: 'Deal', subject_id: deal.id },
    });
  }
}

function logTransition(
  deal: Deal,
  field: string,
  from: string,
  to: string,
  reason: string,
  extraMetadata: Record<string, unknown> = {},
) {
  activity.unshift({
    id: newId('act'),
    deal: deal.id,
    action_type: 'status_change',
    performed_by: MOCK_USER_ID,
    performed_at: nowIso(),
    ip_address: null,
    description: `${field} changed from ${from} to ${to}`,
    old_value: from,
    new_value: to,
    reason,
    metadata: { field, from, to, ...extraMetadata },
  } as ActivityLogEntry);
}

function createNote(body: Record<string, unknown>): DealNote {
  const dealId = String(body.deal ?? '');
  const deal = deals.find((d) => d.id === dealId);
  if (!deal) badRequest('deal', 'Selected deal no longer exists.');
  const text = String(body.body ?? '');
  if (!text.trim()) badRequest('body', 'Note body cannot be empty.');
  const attachmentIds = Array.isArray(body.attachments) ? body.attachments.map(String) : [];
  for (const docId of attachmentIds) {
    const doc = documents.find((d) => d.id === docId);
    if (!doc || doc.deal !== dealId) {
      badRequest('attachments', 'Documents must belong to the same deal.');
    }
  }
  const id = newId('note');
  const iso = nowIso();
  const note: DealNote = {
    id,
    deal: dealId,
    body: text,
    author: MOCK_USER_ID,
    author_username: MOCK_USER.username,
    attachments: attachmentIds,
    visibility_roles: ['internal'],
    created_at: iso,
    updated_at: iso,
  };
  notes.unshift(note);
  activity.unshift({
    id: newId('act'),
    deal: dealId,
    action_type: 'note_added',
    performed_by: MOCK_USER_ID,
    performed_at: iso,
    ip_address: null,
    description: `Note added: ${text.slice(0, 80)}`,
    old_value: '',
    new_value: '',
    reason: '',
    metadata: { subject_model: 'deal_note', subject_id: id, attachment_ids: attachmentIds },
  } as ActivityLogEntry);
  return note;
}

function transitionPipeline(
  deal: Deal,
  to: PipelineStatus,
  reason: string,
  overrideReadiness = false,
): Deal {
  if (!reason?.trim()) badRequest('reason', 'A reason is required for every status transition.');
  const from = deal.pipeline_status;
  if (to === from) badRequest('to_status', 'Deal is already in that pipeline status.');
  let pausedFromStatus: PipelineStatus | null = null;

  if (from === 'on_hold') {
    if (!deal.paused_from_status) badRequest('paused_from_status', 'Cannot resume; paused_from_status is missing.');
    if (to !== 'dead' && to !== deal.paused_from_status) {
      badRequest('to_status', `On-hold deals can only resume to ${deal.paused_from_status} or move to dead.`);
    }
    pausedFromStatus = deal.paused_from_status;
    deal.paused_from_status = null;
  } else {
    if (!PIPELINE_TRANSITIONS[from].includes(to)) {
      badRequest('to_status', `Cannot transition pipeline status from ${from} to ${to}.`);
    }
    if (to === 'on_hold') {
      deal.paused_from_status = from;
      pausedFromStatus = from;
    }
  }
  const readiness = pipelineTransitionReadiness(deal, to);
  const isReadinessOverride = Boolean(
    !readiness.ready && overrideReadiness && readiness.can_override && MOCK_USER.is_staff,
  );
  if (!readiness.ready && !isReadinessOverride) {
    const message = 'This pipeline transition is blocked by readiness requirements.';
    throw new ApiError(message, 400, {
      to_status: [message],
      readiness,
    });
  }
  const transitionedAt = nowIso();
  const openEvent = stageEvents.find((event) => event.deal === deal.id && event.exited_at === null);
  if (openEvent) openEvent.exited_at = transitionedAt;
  stageEvents.unshift({
    id: newId('stage'),
    deal: deal.id,
    from_status: from,
    to_status: to,
    entered_at: transitionedAt,
    exited_at: null,
    performed_by: MOCK_USER_ID,
    performed_by_detail: { id: MOCK_USER_ID, username: MOCK_USER.username },
    reason,
    is_override: isReadinessOverride,
  });
  deal.pipeline_status = to;
  if (to === 'dead' && ['raising', 'fully_subscribed'].includes(deal.syndication_status)) {
    const priorSyndication = deal.syndication_status;
    deal.syndication_status = 'cancelled';
    logTransition(
      deal,
      'syndication_status',
      priorSyndication,
      'cancelled',
      reason,
      { automatic: true, trigger_pipeline_status: 'dead' },
    );
  }
  deal.current_stage_entered_at = transitionedAt;
  deal.days_in_current_stage = 0;
  deal.updated_at = nowIso();
  logTransition(
    deal,
    'pipeline_status',
    from,
    to,
    reason,
    {
      is_override: isReadinessOverride,
      readiness_code: readiness.code,
      readiness_blockers: readiness.blockers,
      ...(pausedFromStatus ? { paused_from_status: pausedFromStatus } : {}),
    },
  );
  return deal;
}

function transitionSyndication(deal: Deal, to: SyndicationStatus, reason: string): Deal {
  if (!reason?.trim()) badRequest('reason', 'A reason is required for every status transition.');
  const from = deal.syndication_status;
  if (to === from) badRequest('to_status', 'Deal is already in that syndication status.');
  if (!SYNDICATION_TRANSITIONS[from].includes(to)) {
    badRequest('to_status', `Cannot transition syndication status from ${from} to ${to}.`);
  }
  if (from === 'not_started' && to === 'raising' && !SYNDICATION_START_STAGES.includes(deal.pipeline_status)) {
    badRequest('pipeline_status', 'Syndication can start only while the deal is quoting through closing.');
  }
  if (from !== 'not_started' && SYNDICATION_TERMINAL_STAGES.includes(deal.pipeline_status)) {
    badRequest('pipeline_status', 'Syndication cannot advance after the deal is dead or exited.');
  }
  deal.syndication_status = to;
  deal.updated_at = nowIso();
  logTransition(deal, 'syndication_status', from, to, reason);
  return deal;
}

function findDocument(id: string): DealDocument {
  const document = documents.find((d) => d.id === id);
  if (!document) throw new ApiError('Not found.', 404, { detail: 'Not found.' });
  return document;
}

function nextDocumentVersion(dealId: string, category: string, documentName: string): number {
  const maxVersion = documents
    .filter((d) => d.deal === dealId && d.category === category && d.document_name === documentName)
    .reduce((max, d) => Math.max(max, d.version), 0);
  return maxVersion + 1;
}

function createUploadIntent(body: Record<string, unknown>): unknown {
  const dealId = String(body.deal ?? '');
  findDeal(dealId);
  const documentName = String(body.document_name ?? '');
  const category = String(body.category ?? 'other');
  const fileType = String(body.file_type ?? 'pdf');
  const version = nextDocumentVersion(dealId, category, documentName);
  const id = newId('doc');
  const document: DealDocument = {
    id,
    deal: dealId,
    document_name: documentName,
    category: category as DealDocument['category'],
    subcategory: String(body.subcategory ?? ''),
    version,
    file_url: `deals/${dealId}/${id}/v${version}/${documentName}.${fileType}`,
    file_type: fileType,
    content_type: String(body.content_type ?? ''),
    file_size_bytes: Number(body.file_size_bytes ?? 0),
    checksum_sha256: '',
    storage_status: 'pending',
    pipeline_stage_at_upload: null,
    uploaded_by: 1,
    uploaded_by_username: 'tchen',
    uploaded_date: nowIso(),
    is_executed: false,
    expiry_date: null,
    notes: String(body.notes ?? ''),
    visibility_roles: (body.visibility_roles as string[]) ?? ['internal'],
    details: {},
  };
  documents.push(document);
  return {
    document,
    upload_url: `/api/documents/${id}/blob/`,
    upload_method: 'PUT',
    upload_headers: { 'Content-Type': document.content_type || 'application/octet-stream' },
    expires_in: 3600,
  };
}

function completeUpload(documentId: string): DealDocument {
  const document = findDocument(documentId);
  document.storage_status = 'ready';
  return document;
}

function downloadDocument(documentId: string) {
  const document = findDocument(documentId);
  if (document.storage_status !== 'ready') {
    throw new ApiError('Document is not ready for download.', 409, { detail: 'Not ready.' });
  }
  const ext = (document.file_type || '').toLowerCase();
  const filename =
    ext && !document.document_name.toLowerCase().endsWith(`.${ext}`)
      ? `${document.document_name}.${ext}`
      : document.document_name;
  return {
    download_url: `/api/documents/${document.id}/blob/`,
    expires_in: 900,
    document_name: document.document_name,
    filename,
    content_type: document.content_type || 'application/octet-stream',
    file_size_bytes: document.file_size_bytes,
  };
}

function findDeal(id: string): Deal {
  const deal = deals.find((d) => d.id === id);
  if (!deal) throw new ApiError('Not found.', 404, { detail: 'Not found.' });
  return deal;
}

function createContact(body: Record<string, unknown>): Contact {
  const fullName = String(body.full_name ?? '').trim();
  if (!fullName) badRequest('full_name', 'Contact name cannot be empty.');
  const email = String(body.email ?? '').trim().toLowerCase();
  if (email && contacts.some((contact) => contact.email.toLowerCase() === email)) {
    badRequest('email', 'A contact with this email already exists.');
  }
  const iso = nowIso();
  const contact: Contact = {
    id: newId('contact'),
    full_name: fullName,
    title: String(body.title ?? '').trim(),
    company_name: String(body.company_name ?? '').trim(),
    email,
    phone: String(body.phone ?? '').trim(),
    details: {},
    created_at: iso,
    updated_at: iso,
  };
  contacts.push(contact);
  return contact;
}

function createDealContact(body: Record<string, unknown>): DealContact {
  const deal = findDeal(String(body.deal ?? ''));
  const contact = contacts.find((row) => row.id === String(body.contact ?? ''));
  if (!contact) badRequest('contact', 'Selected contact no longer exists.');
  const role = String(body.role ?? '') as DealContactRole;
  const validRoles: DealContactRole[] = [
    'source_contact',
    'sponsor_contact',
    'broker_contact',
    'borrower_counsel',
    'lender_counsel',
    'closing_contact',
  ];
  if (!validRoles.includes(role)) badRequest('role', 'Unsupported deal contact role.');
  if (dealContacts.some((link) => link.deal === deal.id && link.contact === contact.id && link.role === role)) {
    badRequest('non_field_errors', 'This contact already has that role on the deal.');
  }
  const isPrimary = body.is_primary === true;
  if (isPrimary && dealContacts.some((link) => link.deal === deal.id && link.role === role && link.is_primary)) {
    badRequest('is_primary', 'This deal already has a primary contact for that role.');
  }
  const iso = nowIso();
  const link: DealContact = {
    id: newId('deal-contact'),
    deal: deal.id,
    contact: contact.id,
    contact_detail: contact,
    role,
    is_primary: isPrimary,
    notes: String(body.notes ?? '').trim(),
    created_at: iso,
    updated_at: iso,
  };
  dealContacts.push(link);
  return link;
}

function screeningInput(body: Record<string, unknown>): CreateScreeningAssessmentPayload {
  const nullableDecimal = (field: string): string | null => {
    const raw = body[field];
    if (raw === null || raw === undefined || raw === '') return null;
    const value = String(raw);
    if (!/^\d+(?:\.\d+)?$/.test(value)) badRequest(field, 'Enter a valid non-negative decimal.');
    return value;
  };
  const positiveInteger = (field: string): number | null => {
    const raw = body[field];
    if (raw === null || raw === undefined || raw === '') return null;
    const value = Number(raw);
    if (!Number.isInteger(value) || value <= 0) badRequest(field, 'Enter a positive whole number.');
    return value;
  };
  const occupancy = nullableDecimal('occupancy');
  if (occupancy !== null && Number(occupancy) > 100) {
    badRequest('occupancy', 'Ensure this value is less than or equal to 100.');
  }
  const proposedRate = nullableDecimal('proposed_rate');
  if (proposedRate !== null && Number(proposedRate) > 100) {
    badRequest('proposed_rate', 'Ensure this value is less than or equal to 100.');
  }
  const equityTargetIrr = nullableDecimal('equity_target_irr');
  if (equityTargetIrr !== null && Number(equityTargetIrr) > 100) {
    badRequest('equity_target_irr', 'Ensure this value is less than or equal to 100.');
  }
  const decision = String(body.decision ?? '');
  if (!['', 'advance', 'refer', 'decline'].includes(decision)) {
    badRequest('decision', 'Select a supported screening decision.');
  }
  return {
    deal: String(body.deal ?? ''),
    loan_amount: nullableDecimal('loan_amount'),
    as_is_value: nullableDecimal('as_is_value'),
    stabilized_value: nullableDecimal('stabilized_value'),
    project_cost: nullableDecimal('project_cost'),
    noi: nullableDecimal('noi'),
    stabilized_noi: nullableDecimal('stabilized_noi'),
    annual_debt_service: nullableDecimal('annual_debt_service'),
    occupancy,
    proposed_rate: proposedRate,
    proposed_term_months: positiveInteger('proposed_term_months'),
    current_average_rent: nullableDecimal('current_average_rent'),
    market_rent: nullableDecimal('market_rent'),
    condition_rating: String(body.condition_rating ?? '') as ScreeningAssessment['condition_rating'],
    unit_mix: String(body.unit_mix ?? ''),
    exit_strategy: String(body.exit_strategy ?? ''),
    exit_cap_rate: nullableDecimal('exit_cap_rate'),
    equity_summary: String(body.equity_summary ?? ''),
    equity_target_irr: equityTargetIrr,
    equity_target_multiple: nullableDecimal('equity_target_multiple'),
    equity_target_hold_months: positiveInteger('equity_target_hold_months'),
    decision: decision as ScreeningAssessment['decision'],
    notes: String(body.notes ?? ''),
  };
}

function requireScreeningStage(deal: Deal): void {
  if (deal.pipeline_status !== 'sourced' && deal.pipeline_status !== 'screening') {
    badRequest(
      'deal',
      'Screening can only be created or changed while the deal is sourced or screening.',
    );
  }
}

function createScreeningAssessment(body: Record<string, unknown>): ScreeningAssessment {
  const input = screeningInput(body);
  if (!input.deal) badRequest('deal', 'A deal is required to create a screening assessment.');
  requireScreeningStage(findDeal(input.deal));
  const current = screeningAssessments.find(
    (assessment) => assessment.deal === input.deal && assessment.is_current,
  );
  if (current?.status === 'draft') {
    badRequest('status', 'Update or finalize the current draft before starting a new version.');
  }
  const version = screeningAssessments
    .filter((assessment) => assessment.deal === input.deal)
    .reduce((highest, assessment) => Math.max(highest, assessment.version), 0) + 1;
  for (const assessment of screeningAssessments) {
    if (assessment.deal === input.deal) assessment.is_current = false;
  }
  const iso = nowIso();
  const metrics = calculateDebtMetrics(input);
  const isComplete = screeningIsComplete(input);
  const assessment: ScreeningAssessment = {
    id: newId('screen'),
    ...input,
    ...metrics,
    version,
    is_current: true,
    is_complete: isComplete,
    missing_fields: isComplete ? [] : screeningMissingFields(input),
    status: 'draft',
    reviewer: null,
    reviewer_detail: null,
    finalized_at: null,
    max_ltv: '0.7500',
    max_ltc: '0.8500',
    min_dscr: '1.2000',
    min_debt_yield: '0.0800',
    created_at: iso,
    updated_at: iso,
  };
  screeningAssessments.unshift(assessment);
  return assessment;
}

function findScreeningAssessment(id: string): ScreeningAssessment {
  const assessment = screeningAssessments.find((row) => row.id === id);
  if (!assessment) throw new ApiError('Not found.', 404, { detail: 'Not found.' });
  return assessment;
}

function updateScreeningAssessment(
  assessment: ScreeningAssessment,
  body: Record<string, unknown>,
): ScreeningAssessment {
  if (assessment.status === 'finalized') {
    badRequest('status', 'Finalized screening assessments are immutable.');
  }
  requireScreeningStage(findDeal(assessment.deal));
  if ('deal' in body && String(body.deal) !== assessment.deal) {
    badRequest('deal', 'An assessment cannot be moved to another deal.');
  }
  const input = screeningInput({ ...assessment, ...body, deal: assessment.deal });
  const isComplete = screeningIsComplete(input);
  Object.assign(assessment, input, calculateDebtMetrics(input), {
    is_complete: isComplete,
    missing_fields: isComplete ? [] : screeningMissingFields(input),
    updated_at: nowIso(),
  });
  return assessment;
}

function finalizeScreeningAssessment(
  assessment: ScreeningAssessment,
  body: Record<string, unknown>,
): ScreeningAssessment {
  if (assessment.status === 'finalized') {
    badRequest('status', 'Only draft screening assessments can be changed.');
  }
  requireScreeningStage(findDeal(assessment.deal));
  const decision = String(body.decision ?? '');
  if (!['advance', 'refer', 'decline'].includes(decision)) {
    badRequest('decision', 'Select a supported screening decision.');
  }
  if (decision === 'advance' && !assessment.is_complete) {
    badRequest('detail', `Complete required screening inputs: ${assessment.missing_fields.join(', ')}.`);
  }
  assessment.decision = decision as FinalScreeningDecision;
  if (typeof body.notes === 'string') assessment.notes = body.notes;
  assessment.status = 'finalized';
  assessment.reviewer = MOCK_USER_ID;
  assessment.reviewer_detail = { id: MOCK_USER_ID, username: MOCK_USER.username };
  assessment.finalized_at = nowIso();
  assessment.updated_at = assessment.finalized_at;
  return assessment;
}

function pipelineTransitionReadiness(deal: Deal, to: PipelineStatus) {
  if (deal.pipeline_status === 'screening' && to === 'quoting') {
    const latest = screeningAssessments
      .filter((assessment) => assessment.deal === deal.id)
      .sort((a, b) => b.version - a.version)[0];
    if (!latest) {
      return {
        ready: false,
        code: 'screening_approval_required',
        blockers: ['screening_assessment_missing'],
        can_override: MOCK_USER.is_staff,
      };
    }
    if (latest.status !== 'finalized') {
      return {
        ready: false,
        code: 'screening_approval_required',
        blockers: ['screening_assessment_not_finalized'],
        can_override: MOCK_USER.is_staff,
      };
    }
    if (latest.decision !== 'advance') {
      return {
        ready: false,
        code: 'screening_approval_required',
        blockers: ['screening_decision_not_advance'],
        can_override: MOCK_USER.is_staff,
      };
    }
    if (!latest.is_complete) {
      return {
        ready: false,
        code: 'screening_approval_required',
        blockers: ['screening_assessment_incomplete'],
        can_override: MOCK_USER.is_staff,
      };
    }
    return {
      ready: true,
      code: 'ready',
      blockers: [],
      can_override: false,
    };
  }

  if (deal.pipeline_status === 'quoting' && to === 'negotiating') {
    const current = getCurrentQuote(deal.id);
    if (!current || !['sent', 'countered', 'executed'].includes(current.status)) {
      return {
        ready: false,
        code: 'quote_readiness_required',
        blockers: ['quote_required_for_negotiating'],
        can_override: MOCK_USER.is_staff,
      };
    }
  }

  if (deal.pipeline_status === 'negotiating' && to === 'signed') {
    const current = getCurrentQuote(deal.id);
    if (!current || current.status !== 'executed') {
      return {
        ready: false,
        code: 'quote_readiness_required',
        blockers: ['quote_execution_required'],
        can_override: MOCK_USER.is_staff,
      };
    }
    const hasEvidence = current.attachments.some((documentId) => {
      try {
        const document = findDocument(documentId);
        return (
          document.storage_status === 'ready' &&
          document.category === 'legal' &&
          (document.subcategory === 'term_sheet' || document.subcategory === 'loi')
        );
      } catch {
        return false;
      }
    });
    if (!hasEvidence) {
      return {
        ready: false,
        code: 'quote_readiness_required',
        blockers: ['quote_execution_evidence_required'],
        can_override: MOCK_USER.is_staff,
      };
    }
  }

  if (deal.pipeline_status === 'closing' && to === 'closed') {
    const blockers = closingReadinessBlockers(deal.id);
    if (blockers.length) {
      return {
        ready: false,
        code: 'closing_readiness_required',
        blockers,
        can_override: MOCK_USER.is_staff,
      };
    }
  }

  if (to === 'exited' && ['raising', 'fully_subscribed'].includes(deal.syndication_status)) {
    return {
      ready: false,
      code: 'syndication_resolution_required',
      blockers: ['syndication_resolution_required'],
      can_override: false,
    };
  }

  return { ready: true, code: 'ready', blockers: [], can_override: false };
}

function screeningMissingFields(input: CreateScreeningAssessmentPayload): string[] {
  const required: Array<keyof CreateScreeningAssessmentPayload> = [
    'loan_amount',
    'project_cost',
    'noi',
    'stabilized_noi',
    'annual_debt_service',
    'occupancy',
    'proposed_rate',
    'proposed_term_months',
    'exit_strategy',
    'exit_cap_rate',
  ];
  const missing = required.filter((field) => input[field] === null || input[field] === '');
  if (!input.as_is_value && !input.stabilized_value) missing.push('as_is_value');
  return missing;
}

function allowedSyndicationTransitions(deal: Deal): SyndicationStatus[] {
  if (
    deal.syndication_status === 'not_started'
    && !SYNDICATION_START_STAGES.includes(deal.pipeline_status)
  ) {
    return [];
  }
  if (
    deal.syndication_status !== 'not_started'
    && SYNDICATION_TERMINAL_STAGES.includes(deal.pipeline_status)
  ) {
    return [];
  }
  return SYNDICATION_TRANSITIONS[deal.syndication_status];
}

function allowedTransitions(deal: Deal) {
  const pipeline: PipelineStatus[] =
    deal.pipeline_status === 'on_hold' && deal.paused_from_status
      ? [deal.paused_from_status, 'dead']
      : PIPELINE_TRANSITIONS[deal.pipeline_status];
  return {
    pipeline_status: pipeline,
    syndication_status: allowedSyndicationTransitions(deal),
    readiness: Object.fromEntries(
      pipeline.map((to) => [to, pipelineTransitionReadiness(deal, to)]),
    ),
  };
}

function clone<T>(value: T): T {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function mockApiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  await delay(180);
  const method = (options.method ?? 'GET').toUpperCase();
  const body: Record<string, unknown> = options.body ? JSON.parse(String(options.body)) : {};
  const [rawPath, rawQuery] = path.split('?');
  const segments = rawPath.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  const query = new URLSearchParams(rawQuery ?? '');
  const route = segments.slice(1); // drop leading "api"

  const result = handle(route, method, body, query);
  return clone(result) as T;
}

function handle(route: string[], method: string, body: Record<string, unknown>, query: URLSearchParams): unknown {
  const [resource, second, third] = route;

  if (resource === 'auth') {
    if (second === 'user') return MOCK_USER;
    if (second === 'logout') return {};
    if (second === 'token') return { access: 'mock-access' };
    return {};
  }

  if (resource === 'deals') {
    if (!second) {
      if (method === 'POST') return createDeal(body);
      return paginate(filterDeals(query), query);
    }
    if (second === 'summary') return buildSummary(query);
    if (second === 'assignees') {
      return [{ id: MOCK_USER_ID, username: MOCK_USER.username }];
    }

    const deal = findDeal(second);
    if (!third) {
      if (method === 'PATCH' || method === 'PUT') return updateDeal(deal, body);
      if (method === 'DELETE') return {};
      return deal;
    }
    if (third === 'allowed-transitions') return allowedTransitions(deal);
    if (third === 'stage-history') {
      const filtered = stageEvents
        .filter((event) => event.deal === deal.id)
        .sort((a, b) => b.entered_at.localeCompare(a.entered_at));
      return paginate(filtered, query);
    }
    if (third === 'transition') {
      return transitionPipeline(
        deal,
        body.to_status as PipelineStatus,
        String(body.reason ?? ''),
        body.override_readiness === true,
      );
    }
    if (third === 'transition-syndication') {
      return transitionSyndication(deal, body.to_status as SyndicationStatus, String(body.reason ?? ''));
    }
  }

  if (resource === 'documents') {
    if (second === 'upload-intent' && method === 'POST') {
      return createUploadIntent(body);
    }
    if (second && third === 'complete' && method === 'POST') {
      return completeUpload(second);
    }
    if (second && third === 'download' && method === 'GET') {
      return downloadDocument(second);
    }
    if (second && !third && (method === 'PATCH' || method === 'PUT')) {
      const document = findDocument(second);
      const evidenceLocked = document.is_executed || documentIsExecutedQuoteEvidence(document.id);
      if (evidenceLocked && 'subcategory' in body) {
        const next = String(body.subcategory ?? '');
        if (next !== (document.subcategory ?? '')) {
          badRequest('subcategory', 'Executed document metadata cannot be changed.');
        }
      }
      if ('subcategory' in body) document.subcategory = String(body.subcategory ?? '');
      if ('expiry_date' in body) document.expiry_date = body.expiry_date ? String(body.expiry_date) : null;
      if ('notes' in body) document.notes = String(body.notes ?? '');
      return document;
    }
    if (second && !third && method === 'DELETE') {
      const document = findDocument(second);
      if (documentIsClosingLinked(document.id)) {
        throw new ApiError('Validation failed', 400, {
          detail: 'Document is linked to a closing checklist item and cannot be deleted.',
        });
      }
      if (documentIsExecutedQuoteEvidence(document.id)) {
        throw new ApiError('Validation failed', 400, {
          detail: 'Document is attached to an executed quote and cannot be deleted.',
        });
      }
      if (document.is_executed && !MOCK_USER.is_staff) {
        throw new ApiError('Only staff may delete executed documents.', 403, {
          detail: 'Only staff may delete executed documents.',
        });
      }
      const idx = documents.findIndex((row) => row.id === document.id);
      if (idx >= 0) documents.splice(idx, 1);
      return {};
    }
    const dealId = query.get('deal');
    const filtered = documents.filter(
      (d) => d.storage_status === 'ready' && (!dealId || d.deal === dealId),
    );
    return paginate(filtered, query);
  }

  if (resource === 'screening-assessments') {
    if (!second) {
      if (method === 'POST') return createScreeningAssessment(body);
      const dealId = query.get('deal');
      const status = query.get('status');
      if (status && !['draft', 'finalized'].includes(status)) {
        badRequest('status', 'Unsupported screening status.');
      }
      const currentFilter = query.get('current');
      if (currentFilter !== null && !['true', 'false', '1', '0'].includes(currentFilter.toLowerCase())) {
        badRequest('current', 'Expected true or false.');
      }
      const currentOnly = currentFilter === null
        ? null
        : ['true', '1'].includes(currentFilter.toLowerCase());
      const filtered = screeningAssessments.filter(
        (assessment) =>
          (!dealId || assessment.deal === dealId)
          && (!status || assessment.status === status)
          && (currentOnly === null || assessment.is_current === currentOnly),
      );
      return paginate(filtered, query);
    }
    const assessment = findScreeningAssessment(second);
    if (third === 'finalize' && method === 'POST') {
      return finalizeScreeningAssessment(assessment, body);
    }
    if (method === 'PATCH' || method === 'PUT') return updateScreeningAssessment(assessment, body);
    if (method === 'DELETE') {
      badRequest('status', 'Screening assessment versions cannot be deleted; create a new version instead.');
    }
    return assessment;
  }

  if (resource === 'quotes') {
    return handleQuotesRequest({
      method,
      second,
      third,
      query,
      body,
      findDeal,
      findDocument,
      paginate,
      getScreeningSeed: (dealId) => {
        const assessment = screeningAssessments
          .filter(
            (row) =>
              row.deal === dealId &&
              row.status === 'finalized' &&
              row.decision === 'advance',
          )
          .sort((a, b) => b.version - a.version)[0];
        if (!assessment) return null;
        return {
          loan_amount: assessment.loan_amount,
          interest_rate: assessment.proposed_rate,
          term_months: assessment.proposed_term_months,
        };
      },
    });
  }

  if (
    resource === 'dd-templates' ||
    resource === 'closing-packages' ||
    resource === 'closing-generations' ||
    resource === 'dd-checklist-items' ||
    resource === 'conditions-precedent'
  ) {
    const dealId = resolveClosingDealId({
      resource,
      id: second,
      action: third,
      query,
      body,
    });
    const deal = dealId ? deals.find((row) => row.id === dealId) : undefined;
    const closingResponse = handleClosingRequest({
      method,
      resource,
      id: second,
      action: third,
      query,
      body,
      dealStatus: deal?.pipeline_status,
      isStaff: MOCK_USER.is_staff,
      resolveDocuments: (ids) =>
        ids
          .map((docId) => documents.find((doc) => doc.id === docId && doc.storage_status === 'ready'))
          .filter((doc): doc is (typeof documents)[number] => Boolean(doc))
          .map((doc) => ({
            id: doc.id,
            document_name: doc.document_name,
            category: doc.category,
            subcategory: doc.subcategory,
            storage_status: doc.storage_status,
            file_type: doc.file_type,
            file_size_bytes: doc.file_size_bytes,
            visibility_roles: doc.visibility_roles,
          })),
    });
    if (closingResponse !== null) return closingResponse;
  }

  if (resource === 'contacts') {
    if (!second && method === 'POST') return createContact(body);
    if (second && (method === 'PATCH' || method === 'PUT')) {
      const contact = contacts.find((row) => row.id === second);
      if (!contact) throw new ApiError('Not found', 404, { detail: 'Not found.' });
      for (const field of ['full_name', 'title', 'company_name', 'email', 'phone'] as const) {
        if (field in body) contact[field] = String(body[field] ?? '').trim();
      }
      if (!contact.full_name) badRequest('full_name', 'Contact name cannot be empty.');
      contact.updated_at = nowIso();
      for (const link of dealContacts) {
        if (link.contact === contact.id) link.contact_detail = contact;
      }
      return contact;
    }
    return paginate(contacts, query);
  }

  if (resource === 'deal-contacts') {
    if (!second && method === 'POST') return createDealContact(body);
    if (second && (method === 'PATCH' || method === 'PUT')) {
      const link = dealContacts.find((row) => row.id === second);
      if (!link) throw new ApiError('Not found', 404, { detail: 'Not found.' });
      if ('is_primary' in body) link.is_primary = Boolean(body.is_primary);
      if ('notes' in body) link.notes = String(body.notes ?? '');
      link.updated_at = nowIso();
      return link;
    }
    if (second && method === 'DELETE') {
      const index = dealContacts.findIndex((row) => row.id === second);
      if (index < 0) throw new ApiError('Not found', 404, { detail: 'Not found.' });
      dealContacts.splice(index, 1);
      return {};
    }
    const dealId = query.get('deal');
    const role = query.get('role');
    const filtered = dealContacts.filter(
      (link) => (!dealId || link.deal === dealId) && (!role || link.role === role),
    );
    return paginate(filtered, query);
  }

  if (resource === 'deal-notes') {
    if (!second && method === 'POST') return createNote(body);
    if (second && method === 'DELETE') {
      const idx = notes.findIndex((n) => n.id === second);
      if (idx === -1) throw new ApiError('Not found', 404, { detail: 'Not found.' });
      notes.splice(idx, 1);
      return {};
    }
    if (second && (method === 'PATCH' || method === 'PUT')) {
      const note = notes.find((n) => n.id === second);
      if (!note) throw new ApiError('Not found', 404, { detail: 'Not found.' });
      if ('deal' in body && body.deal !== note.deal) {
        badRequest('deal', 'deal cannot be changed after creation.');
      }
      if (typeof body.body === 'string') {
        if (!body.body.trim()) badRequest('body', 'Note body cannot be empty.');
        note.body = body.body;
      }
      // Attachments are intentionally not mirrored on edit here: there is no edit-attachments
      // UI surface yet, so Demo/Live parity is maintained for all reachable paths.
      note.updated_at = nowIso();
      return note;
    }
    const dealId = query.get('deal');
    const filtered = dealId ? notes.filter((n) => n.deal === dealId) : notes;
    return paginate(filtered, query);
  }

  if (resource === 'activity-logs') {
    const dealId = query.get('deal');
    const filtered = dealId ? activity.filter((a) => a.deal === dealId) : activity;
    return paginate(filtered, query);
  }

  if (resource === 'sponsors') {
    if (second) {
      const sponsor = findSponsor(second);
      if (method === 'DELETE') return deleteSponsor(sponsor);
      if (method === 'PATCH' || method === 'PUT') {
        return updateSponsor(sponsor, body, method === 'PATCH');
      }
      return sponsor;
    }
    if (method === 'POST') return resolveSponsor(body);
    return paginate(sponsors, query);
  }
  if (resource === 'brokers') {
    if (method === 'POST') return resolveBroker(body);
    return paginate(brokers, query);
  }
  if (resource === 'funds') return paginate(funds, query);
  if (resource === 'properties') {
    if (second) {
      const property = findProperty(second);
      if (method === 'DELETE') return deleteProperty(property);
      if (method === 'PATCH' || method === 'PUT') {
        return updateProperty(property, body, method === 'PATCH');
      }
      return property;
    }
    if (method === 'POST') return resolveProperty(body);
    return paginate(properties, query);
  }

  throw new ApiError(`No mock handler for /${route.join('/')}`, 404, { detail: 'Not found.' });
}
