// Sample data for the mock API layer. Lets every deal view render populated
// without a live backend or seeded database. See src/mocks/handlers.ts.

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

export const FUNDS: Fund[] = [
  { id: 'fund-credit-2', name: 'MRJ Credit Fund II', status: 'open', details: {} },
  { id: 'fund-equity-1', name: 'MRJ Equity Opportunities I', status: 'forming', details: {} },
];

export const SPONSORS: Sponsor[] = [
  {
    id: 'sp-larkspur',
    entity_name: 'Larkspur Capital Partners',
    entity_type: 'llc',
    primary_contact_name: 'Dana Reyes',
    primary_contact_email: 'dana@larkspurcap.com',
    primary_contact_phone: '(512) 555-0142',
    relationship_rating: 'strategic',
    details: {},
  },
  {
    id: 'sp-cobalt',
    entity_name: 'Cobalt Real Estate Group',
    entity_type: 'lp',
    primary_contact_name: 'Marcus Hale',
    primary_contact_email: 'mhale@cobaltreg.com',
    primary_contact_phone: '(214) 555-0188',
    relationship_rating: 'established',
    details: {},
  },
  {
    id: 'sp-marisol',
    entity_name: 'Marisol Holdings',
    entity_type: 'llc',
    primary_contact_name: 'Elena Park',
    primary_contact_email: 'elena@marisolhold.com',
    primary_contact_phone: '(602) 555-0119',
    relationship_rating: 'developing',
    details: {},
  },
  {
    id: 'sp-harbor',
    entity_name: 'Harbor Point Ventures',
    entity_type: 'corp',
    primary_contact_name: 'Will Tanaka',
    primary_contact_email: 'will@harborpoint.vc',
    primary_contact_phone: '(206) 555-0173',
    relationship_rating: 'new',
    details: {},
  },
  {
    id: 'sp-vista',
    entity_name: 'Vista Ridge Partners',
    entity_type: 'lp',
    primary_contact_name: 'Sofia Mendez',
    primary_contact_email: 'sofia@vistaridge.com',
    primary_contact_phone: '(303) 555-0150',
    relationship_rating: 'established',
    details: {},
  },
  {
    id: 'sp-riverside',
    entity_name: 'Riverside Development Co',
    entity_type: 'llc',
    primary_contact_name: 'Grant Whitman',
    primary_contact_email: 'grant@riversidedev.com',
    primary_contact_phone: '(813) 555-0136',
    relationship_rating: 'strategic',
    details: {},
  },
];

export const BROKERS: Broker[] = [
  {
    id: 'bk-eastdil',
    company_name: 'Eastdil Secured',
    contact_name: 'Jane Whitfield',
    email: 'jwhitfield@eastdil.com',
    phone: '(212) 555-0101',
    status: 'active',
    details: {},
  },
  {
    id: 'bk-cbre',
    company_name: 'CBRE Capital Markets',
    contact_name: 'Marcus Lee',
    email: 'marcus.lee@cbre.com',
    phone: '(312) 555-0166',
    status: 'active',
    details: {},
  },
  {
    id: 'bk-jll',
    company_name: 'JLL Capital Markets',
    contact_name: 'Priya Nair',
    email: 'priya.nair@jll.com',
    phone: '(404) 555-0124',
    status: 'active',
    details: {},
  },
  {
    id: 'bk-walker',
    company_name: 'Walker & Dunlop',
    contact_name: 'Tom Ramsey',
    email: 'tramsey@walkerdunlop.com',
    phone: '(301) 555-0190',
    status: 'inactive',
    details: {},
  },
];

function property(
  id: string,
  address: string,
  city: string,
  state: string,
  zip: string,
  type: Property['property_type'],
  msa: string,
): Property {
  return {
    id,
    address_normalized: `${address} ${city} ${state} ${zip}`.toUpperCase(),
    address,
    city,
    state,
    zip,
    property_type: type,
    msa,
    details: {},
  };
}

export const PROPERTIES: Property[] = [
  property('pr-larkspur', '1400 Larkspur Lane', 'Austin', 'TX', '78745', 'multifamily', 'Austin-Round Rock'),
  property('pr-cobalt-1', '900 Distribution Pkwy', 'Dallas', 'TX', '75212', 'industrial', 'Dallas-Fort Worth'),
  property('pr-cobalt-2', '950 Distribution Pkwy', 'Dallas', 'TX', '75212', 'industrial', 'Dallas-Fort Worth'),
  property('pr-marisol', '88 Roosevelt Row', 'Phoenix', 'AZ', '85004', 'mixed_use', 'Phoenix-Mesa'),
  property('pr-harbor', '500 Elliott Ave W', 'Seattle', 'WA', '98119', 'office', 'Seattle-Tacoma'),
  property('pr-vista', '2200 Ridge Rd', 'Denver', 'CO', '80211', 'self_storage', 'Denver-Aurora'),
  property('pr-sterling', '310 Broadway', 'Nashville', 'TN', '37201', 'hotel', 'Nashville-Davidson'),
  property('pr-oakmont', '4750 Sharon Rd', 'Charlotte', 'NC', '28210', 'retail', 'Charlotte-Concord'),
  property('pr-riverside', '700 Bayshore Blvd', 'Tampa', 'FL', '33606', 'multifamily', 'Tampa-St. Petersburg'),
  property('pr-granite', '1200 Logistics Way', 'Columbus', 'OH', '43228', 'industrial', 'Columbus'),
  property('pr-beacon', '210 N Wacker Dr', 'Chicago', 'IL', '60606', 'office', 'Chicago-Naperville'),
  property('pr-summit', '0 Highway 44', 'Boise', 'ID', '83709', 'land', 'Boise City'),
  property('pr-pinewood', '1801 Sunrise Valley Dr', 'Reston', 'VA', '20191', 'data_center', 'Washington-Arlington'),
  property('pr-maple', '125 NW Maple Ct', 'Portland', 'OR', '97209', 'condo', 'Portland-Vancouver'),
  property('pr-ironwood', '3400 Channel Ave', 'Memphis', 'TN', '38106', 'industrial', 'Memphis'),
];

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

interface DealSeed {
  id: string;
  name: string;
  investment_type: Deal['investment_type'];
  investment_category: Deal['investment_category'];
  pipeline_status: Deal['pipeline_status'];
  syndication_status: Deal['syndication_status'];
  paused_from_status?: Deal['pipeline_status'];
  sponsor: string;
  broker?: string;
  fund?: string;
  source_channel: Deal['source_channel'];
  source_date: string;
  requested_amount: string;
  properties: [string, boolean][];
}

const DEAL_SEEDS: DealSeed[] = [
  { id: 'deal-larkspur', name: 'Larkspur Apartments Bridge', investment_type: 'whole_loan_bridge', investment_category: 'debt', pipeline_status: 'quoting', syndication_status: 'raising', sponsor: 'sp-larkspur', broker: 'bk-eastdil', fund: 'fund-credit-2', source_channel: 'broker', source_date: '2026-05-18', requested_amount: '12400000.00', properties: [['pr-larkspur', true]] },
  { id: 'deal-cobalt', name: 'Cobalt Industrial Portfolio', investment_type: 'whole_loan_permanent', investment_category: 'debt', pipeline_status: 'negotiating', syndication_status: 'not_started', sponsor: 'sp-cobalt', broker: 'bk-cbre', fund: 'fund-credit-2', source_channel: 'repeat_sponsor', source_date: '2026-04-30', requested_amount: '28000000.00', properties: [['pr-cobalt-1', true], ['pr-cobalt-2', false]] },
  { id: 'deal-marisol', name: 'Marisol Mixed-Use', investment_type: 'mezzanine', investment_category: 'hybrid', pipeline_status: 'screening', syndication_status: 'not_started', sponsor: 'sp-marisol', broker: 'bk-jll', source_channel: 'broker', source_date: '2026-06-02', requested_amount: '8500000.00', properties: [['pr-marisol', true]] },
  { id: 'deal-harbor', name: 'Harbor Point Office', investment_type: 'preferred_equity', investment_category: 'hybrid', pipeline_status: 'sourced', syndication_status: 'not_started', sponsor: 'sp-harbor', source_channel: 'direct', source_date: '2026-06-12', requested_amount: '15000000.00', properties: [['pr-harbor', true]] },
  { id: 'deal-vista', name: 'Vista Ridge Self-Storage', investment_type: 'lp_equity', investment_category: 'equity', pipeline_status: 'closing', syndication_status: 'fully_subscribed', sponsor: 'sp-vista', broker: 'bk-walker', fund: 'fund-equity-1', source_channel: 'referral', source_date: '2026-03-21', requested_amount: '6200000.00', properties: [['pr-vista', true]] },
  { id: 'deal-sterling', name: 'Sterling Hotel Refi', investment_type: 'whole_loan_bridge', investment_category: 'debt', pipeline_status: 'signed', syndication_status: 'raising', sponsor: 'sp-larkspur', broker: 'bk-eastdil', fund: 'fund-credit-2', source_channel: 'repeat_sponsor', source_date: '2026-04-08', requested_amount: '34000000.00', properties: [['pr-sterling', true]] },
  { id: 'deal-oakmont', name: 'Oakmont Retail Center', investment_type: 'co_gp_equity', investment_category: 'equity', pipeline_status: 'closed', syndication_status: 'closed', sponsor: 'sp-cobalt', broker: 'bk-cbre', fund: 'fund-equity-1', source_channel: 'broker', source_date: '2026-01-15', requested_amount: '19750000.00', properties: [['pr-oakmont', true]] },
  { id: 'deal-riverside', name: 'Riverside Multifamily Dev', investment_type: 'co_gp_equity', investment_category: 'equity', pipeline_status: 'servicing', syndication_status: 'closed', sponsor: 'sp-riverside', fund: 'fund-equity-1', source_channel: 'internal_prospecting', source_date: '2025-11-03', requested_amount: '42000000.00', properties: [['pr-riverside', true]] },
  { id: 'deal-granite', name: 'Granite Logistics Hub', investment_type: 'whole_loan_bridge', investment_category: 'debt', pipeline_status: 'on_hold', syndication_status: 'not_started', paused_from_status: 'quoting', sponsor: 'sp-marisol', broker: 'bk-jll', source_channel: 'broker', source_date: '2026-02-26', requested_amount: '22000000.00', properties: [['pr-granite', true]] },
  { id: 'deal-beacon', name: 'Beacon Tower Mezz', investment_type: 'mezzanine', investment_category: 'hybrid', pipeline_status: 'dead', syndication_status: 'not_started', sponsor: 'sp-harbor', broker: 'bk-cbre', source_channel: 'direct', source_date: '2026-02-10', requested_amount: '11000000.00', properties: [['pr-beacon', true]] },
  { id: 'deal-summit', name: 'Summit Land Assemblage', investment_type: 'preferred_equity', investment_category: 'hybrid', pipeline_status: 'exited', syndication_status: 'closed', sponsor: 'sp-vista', source_channel: 'referral', source_date: '2025-09-19', requested_amount: '9400000.00', properties: [['pr-summit', true]] },
  { id: 'deal-pinewood', name: 'Pinewood Data Center', investment_type: 'preferred_equity', investment_category: 'hybrid', pipeline_status: 'quoting', syndication_status: 'raising', sponsor: 'sp-riverside', broker: 'bk-eastdil', fund: 'fund-credit-2', source_channel: 'repeat_sponsor', source_date: '2026-05-29', requested_amount: '55000000.00', properties: [['pr-pinewood', true]] },
  { id: 'deal-maple', name: 'Maple Court Condos', investment_type: 'lp_equity', investment_category: 'equity', pipeline_status: 'sourced', syndication_status: 'not_started', sponsor: 'sp-larkspur', source_channel: 'direct', source_date: '2026-06-15', requested_amount: '7800000.00', properties: [['pr-maple', true]] },
  { id: 'deal-ironwood', name: 'Ironwood Industrial', investment_type: 'whole_loan_permanent', investment_category: 'debt', pipeline_status: 'screening', syndication_status: 'not_started', sponsor: 'sp-cobalt', broker: 'bk-walker', source_channel: 'repeat_sponsor', source_date: '2026-06-06', requested_amount: '16300000.00', properties: [['pr-ironwood', true]] },
];

export function buildInitialDeals(): Deal[] {
  return DEAL_SEEDS.map((seed) => ({
    id: seed.id,
    name: seed.name,
    investment_type: seed.investment_type,
    investment_category: seed.investment_category,
    pipeline_status: seed.pipeline_status,
    syndication_status: seed.syndication_status,
    paused_from_status: seed.paused_from_status ?? null,
    sponsor: seed.sponsor,
    sponsor_detail: sponsorById[seed.sponsor],
    broker: seed.broker ?? null,
    broker_detail: seed.broker ? brokerById[seed.broker] : null,
    assigned_analyst: ANALYST.id,
    assigned_analyst_detail: ANALYST,
    fund: seed.fund ?? null,
    fund_detail: seed.fund ? fundById[seed.fund] : null,
    source_channel: seed.source_channel,
    source_date: seed.source_date,
    requested_amount: seed.requested_amount,
    details: {},
    properties: dealProps(seed.properties),
    created_at: `${seed.source_date}T15:00:00Z`,
    updated_at: `${seed.source_date}T15:00:00Z`,
  }));
}

export const DOCUMENTS: DealDocument[] = [
  doc('doc-1', 'deal-larkspur', 'Larkspur OM.pdf', 'offering_memo', 1, 'pdf', true, null),
  doc('doc-2', 'deal-larkspur', 'T-12 Operating Statement.xlsx', 'financials', 2, 'xlsx', false, null),
  doc('doc-3', 'deal-larkspur', 'Rent Roll - May 2026.xlsx', 'rent_roll', 1, 'xlsx', false, null),
  doc('doc-4', 'deal-larkspur', 'Phase I ESA.pdf', 'environmental', 1, 'pdf', false, '2027-05-01'),
  doc('doc-5', 'deal-oakmont', 'Executed Loan Agreement.pdf', 'closing_docs', 3, 'pdf', true, null),
  doc('doc-6', 'deal-oakmont', 'Title Commitment.pdf', 'title', 1, 'pdf', true, null),
  doc('doc-7', 'deal-oakmont', 'Property Insurance Binder.pdf', 'insurance', 1, 'pdf', true, '2027-01-15'),
  doc('doc-8', 'deal-cobalt', 'Appraisal - Cobalt Portfolio.pdf', 'appraisal', 1, 'pdf', false, '2027-04-30'),
];

function doc(
  id: string,
  deal: string,
  name: string,
  category: DealDocument['category'],
  version: number,
  fileType: string,
  isExecuted: boolean,
  expiry: string | null,
): DealDocument {
  return {
    id,
    deal,
    document_name: name,
    category,
    version,
    file_url: `deals/${deal}/${id}.${fileType}`,
    file_type: fileType,
    uploaded_by: ANALYST.id,
    uploaded_date: '2026-05-20T16:30:00Z',
    is_executed: isExecuted,
    expiry_date: expiry,
    notes: '',
    visibility_roles: ['internal'],
    details: {},
  };
}

export const ACTIVITY: ActivityLogEntry[] = [
  activity('act-1', 'deal-larkspur', 'Pipeline status changed from screening to quoting', 'screening', 'quoting', 'Term sheet issued to sponsor', '2026-05-25T14:12:00Z'),
  activity('act-2', 'deal-larkspur', 'Pipeline status changed from sourced to screening', 'sourced', 'screening', 'Cleared initial credit screen', '2026-05-20T10:02:00Z'),
  activity('act-3', 'deal-oakmont', 'Pipeline status changed from closing to closed', 'closing', 'closed', 'Funded and recorded', '2026-02-28T19:45:00Z'),
  activity('act-4', 'deal-oakmont', 'Pipeline status changed from signed to closing', 'signed', 'closing', 'Cleared closing conditions', '2026-02-14T15:20:00Z'),
];

function activity(
  id: string,
  deal: string,
  description: string,
  oldValue: string,
  newValue: string,
  reason: string,
  performedAt: string,
): ActivityLogEntry {
  return {
    id,
    deal,
    action_type: 'status_change',
    performed_by: ANALYST.id,
    performed_at: performedAt,
    ip_address: null,
    description,
    old_value: oldValue,
    new_value: newValue,
    reason,
    metadata: { field: 'pipeline_status', from: oldValue, to: newValue },
  };
}
