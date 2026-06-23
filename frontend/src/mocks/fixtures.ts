// Sample data for the mock API layer. Source of truth: shared/demo_seed.json
// (also loaded into Postgres via `python manage.py seed_demo_data`).

import demoSeed from '@shared/demo_seed.json';
import type {
  ActivityLogEntry,
  Broker,
  Deal,
  DealDocument,
  DealPropertySummary,
  Fund,
  Property,
  Sponsor,
} from '@/types/deal';

export const MOCK_USER = {
  username: 'tchen',
  email: 't@slow.rodeo',
  is_staff: true,
};

const ANALYST = { id: 1, username: 'tchen' };

function withDetails<T extends object>(row: T): T & { details: Record<string, never> } {
  return { ...row, details: {} };
}

export const FUNDS: Fund[] = demoSeed.funds.map((row) =>
  withDetails({ id: row.id, name: row.name, status: row.status as Fund['status'] }),
);

export const SPONSORS: Sponsor[] = demoSeed.sponsors.map((row) =>
  withDetails({
    id: row.id,
    entity_name: row.entity_name,
    entity_type: row.entity_type as Sponsor['entity_type'],
    primary_contact_name: row.primary_contact_name,
    primary_contact_email: row.primary_contact_email,
    primary_contact_phone: row.primary_contact_phone,
    relationship_rating: row.relationship_rating as Sponsor['relationship_rating'],
  }),
);

export const BROKERS: Broker[] = demoSeed.brokers.map((row) =>
  withDetails({
    id: row.id,
    company_name: row.company_name,
    contact_name: row.contact_name,
    email: row.email,
    phone: row.phone,
    status: row.status as Broker['status'],
  }),
);

function propertyRow(row: (typeof demoSeed.properties)[number]): Property {
  return withDetails({
    id: row.id,
    address_normalized: `${row.address} ${row.city} ${row.state} ${row.zip}`.toUpperCase(),
    address: row.address,
    city: row.city,
    state: row.state,
    zip: row.zip,
    property_type: row.property_type as Property['property_type'],
    msa: row.msa,
  });
}

export const PROPERTIES: Property[] = demoSeed.properties.map(propertyRow);

const propertyById = Object.fromEntries(PROPERTIES.map((p) => [p.id, p])) as Record<string, Property>;

let dealPropertyPk = 1;
function dealProps(entries: [string, boolean][]): DealPropertySummary[] {
  return entries.map(([propertyId, isPrimary]) => ({
    id: dealPropertyPk++,
    property: propertyById[propertyId],
    is_primary: isPrimary,
  }));
}

const sponsorById = Object.fromEntries(SPONSORS.map((s) => [s.id, s])) as Record<string, Sponsor>;
const brokerById = Object.fromEntries(BROKERS.map((b) => [b.id, b])) as Record<string, Broker>;
const fundById = Object.fromEntries(FUNDS.map((f) => [f.id, f])) as Record<string, Fund>;

function investmentCategory(investmentType: Deal['investment_type']): Deal['investment_category'] {
  if (investmentType === 'whole_loan_bridge' || investmentType === 'whole_loan_permanent') {
    return 'debt';
  }
  if (investmentType === 'mezzanine' || investmentType === 'preferred_equity') {
    return 'hybrid';
  }
  return 'equity';
}

export function buildInitialDeals(): Deal[] {
  return demoSeed.deals.map((seed) => ({
    id: seed.id,
    name: seed.name,
    investment_type: seed.investment_type as Deal['investment_type'],
    investment_category: investmentCategory(seed.investment_type as Deal['investment_type']),
    pipeline_status: seed.pipeline_status as Deal['pipeline_status'],
    syndication_status: seed.syndication_status as Deal['syndication_status'],
    paused_from_status: (seed.paused_from_status as Deal['paused_from_status']) ?? null,
    sponsor: seed.sponsor,
    sponsor_detail: sponsorById[seed.sponsor],
    broker: seed.broker ?? null,
    broker_detail: seed.broker ? brokerById[seed.broker] : null,
    assigned_analyst: ANALYST.id,
    assigned_analyst_detail: ANALYST,
    fund: seed.fund ?? null,
    fund_detail: seed.fund ? fundById[seed.fund] : null,
    source_channel: seed.source_channel as Deal['source_channel'],
    source_date: seed.source_date,
    requested_amount: seed.requested_amount,
    details: {},
    properties: dealProps(seed.properties as [string, boolean][]),
    created_at: `${seed.source_date}T15:00:00Z`,
    updated_at: `${seed.source_date}T15:00:00Z`,
  }));
}

export const DOCUMENTS: DealDocument[] = demoSeed.documents.map((row) => ({
  id: row.id,
  deal: row.deal,
  document_name: row.document_name,
  category: row.category as DealDocument['category'],
  version: row.version,
  file_url: `deals/${row.deal}/${row.id}.${row.file_type}`,
  file_type: row.file_type,
  uploaded_by: ANALYST.id,
  uploaded_date: '2026-05-20T16:30:00Z',
  is_executed: row.is_executed,
  expiry_date: row.expiry_date,
  notes: '',
  visibility_roles: ['internal'],
  details: {},
}));

export const ACTIVITY: ActivityLogEntry[] = demoSeed.activity.map((row) => ({
  id: row.id,
  deal: row.deal,
  action_type: 'status_change',
  performed_by: ANALYST.id,
  performed_at: row.performed_at,
  ip_address: null,
  description: row.description,
  old_value: row.old_value,
  new_value: row.new_value,
  reason: row.reason,
  metadata: { field: 'pipeline_status', from: row.old_value, to: row.new_value },
}));
