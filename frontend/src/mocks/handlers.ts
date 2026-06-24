// In-memory mock API. Routes path + method to fixture data and mirrors the
// backend's transition rules and nested-write create contract closely enough to
// exercise every view. State lives for the page session and resets on reload.

import { ApiError } from '@/lib/apiError';
import type {
  ActivityLogEntry,
  Broker,
  Deal,
  DealPropertySummary,
  Fund,
  InvestmentType,
  PipelineStatus,
  Property,
  Sponsor,
  SyndicationStatus,
} from '@/types/deal';
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

const deals = buildInitialDeals();
const sponsors = [...SPONSORS];
const brokers = [...BROKERS];
const funds = [...FUNDS];
const properties = [...PROPERTIES];
const documents = [...DOCUMENTS];
const activity = [...ACTIVITY];

const SYNDICATION_TRANSITIONS: Record<SyndicationStatus, SyndicationStatus[]> = {
  not_started: ['raising'],
  raising: ['fully_subscribed'],
  fully_subscribed: ['closed'],
  closed: [],
};

const SYNDICATION_START_STAGES: PipelineStatus[] = ['quoting', 'negotiating', 'signed', 'closing'];
const SYNDICATION_TERMINAL_STAGES: PipelineStatus[] = ['dead', 'exited'];

let idCounter = 1000;
const newId = (prefix: string) => `${prefix}-${idCounter++}`;
const nowIso = () => new Date().toISOString();

function badRequest(field: string, message: string): never {
  throw new ApiError(message, 400, { [field]: [message] });
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
  const active = filtered.filter((d) => d.pipeline_status !== 'dead' && d.pipeline_status !== 'exited');
  const sum = (list: Deal[]) => list.reduce((total, d) => total + (Number(d.requested_amount) || 0), 0);
  const counts = new Map<PipelineStatus, number>();
  for (const deal of filtered) counts.set(deal.pipeline_status, (counts.get(deal.pipeline_status) ?? 0) + 1);
  return {
    active_deals: active.length,
    pipeline_value: sum(active),
    gross_pipeline_value: sum(filtered),
    by_pipeline_status: [...counts.entries()].map(([pipeline_status, count]) => ({ pipeline_status, count })),
  };
}

let dealPropertyPk = 5000;

function resolveSponsor(input: unknown): Sponsor {
  if (typeof input === 'string') {
    const existing = sponsors.find((s) => s.id === input);
    if (!existing) badRequest('sponsor', 'Selected sponsor no longer exists.');
    return existing!;
  }
  const data = input as Partial<Sponsor>;
  const created: Sponsor = {
    id: newId('sp'),
    entity_name: data.entity_name ?? 'New Sponsor',
    entity_type: data.entity_type ?? 'llc',
    primary_contact_name: data.primary_contact_name ?? '',
    primary_contact_email: data.primary_contact_email ?? '',
    primary_contact_phone: data.primary_contact_phone ?? '',
    relationship_rating: data.relationship_rating ?? 'new',
    details: {},
  };
  sponsors.push(created);
  return created;
}

function resolveBroker(input: unknown): Broker | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'string') return brokers.find((b) => b.id === input) ?? null;
  const data = input as Partial<Broker>;
  const created: Broker = {
    id: newId('bk'),
    company_name: data.company_name ?? 'New Broker',
    contact_name: data.contact_name ?? '',
    email: data.email ?? '',
    phone: data.phone ?? '',
    status: 'active',
    details: {},
  };
  brokers.push(created);
  return created;
}

function resolveProperty(input: unknown): Property {
  if (typeof input === 'string') {
    const existing = properties.find((p) => p.id === input);
    if (!existing) badRequest('properties', 'Selected property no longer exists.');
    return existing!;
  }
  const data = input as Partial<Property>;
  const created: Property = {
    id: newId('pr'),
    address: data.address ?? '',
    address_normalized: `${data.address ?? ''} ${data.city ?? ''} ${data.state ?? ''} ${data.zip ?? ''}`.toUpperCase(),
    city: data.city ?? '',
    state: (data.state ?? '').toUpperCase(),
    zip: data.zip ?? '',
    property_type: data.property_type ?? 'other',
    msa: data.msa ?? '',
    details: {},
  };
  properties.push(created);
  return created;
}

function toDealProperties(props: Property[]): DealPropertySummary[] {
  return props.map((property, index) => ({
    id: dealPropertyPk++,
    property,
    is_primary: index === 0,
  }));
}

function createDeal(body: Record<string, unknown>): Deal {
  const sponsor = resolveSponsor(body.sponsor);
  const broker = resolveBroker(body.broker);
  const fundId = (body.fund as string | null) || null;
  const fund: Fund | null = fundId ? funds.find((f) => f.id === fundId) ?? null : null;
  const propertyInputs = Array.isArray(body.properties) ? body.properties : [];
  if (propertyInputs.length === 0) badRequest('properties', 'Add at least one property.');
  const resolvedProperties = propertyInputs.map(resolveProperty);
  const investmentType = body.investment_type as InvestmentType;

  const deal: Deal = {
    id: newId('deal'),
    name: String(body.name ?? 'Untitled deal'),
    investment_type: investmentType,
    investment_category: deriveCategory(investmentType),
    pipeline_status: 'sourced',
    syndication_status: 'not_started',
    paused_from_status: null,
    sponsor: sponsor.id,
    sponsor_detail: sponsor,
    broker: broker?.id ?? null,
    broker_detail: broker,
    assigned_analyst: MOCK_USER_ID,
    assigned_analyst_detail: { id: MOCK_USER_ID, username: MOCK_USER.username },
    fund: fund?.id ?? null,
    fund_detail: fund,
    source_channel: body.source_channel as Deal['source_channel'],
    source_date: String(body.source_date ?? nowIso().slice(0, 10)),
    requested_amount: String(body.requested_amount ?? '0'),
    details: {},
    properties: toDealProperties(resolvedProperties),
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  deals.unshift(deal);
  return deal;
}

function updateDeal(deal: Deal, body: Record<string, unknown>): Deal {
  if (typeof body.name === 'string') deal.name = body.name;
  if (typeof body.investment_type === 'string') {
    deal.investment_type = body.investment_type as InvestmentType;
    deal.investment_category = deriveCategory(deal.investment_type);
  }
  if (body.requested_amount !== undefined) deal.requested_amount = String(body.requested_amount);
  if (typeof body.source_channel === 'string') deal.source_channel = body.source_channel as Deal['source_channel'];
  if (typeof body.source_date === 'string') deal.source_date = body.source_date;
  if ('fund' in body) {
    const fundId = (body.fund as string | null) || null;
    deal.fund = fundId;
    deal.fund_detail = fundId ? funds.find((f) => f.id === fundId) ?? null : null;
  }
  if (Array.isArray(body.property_ids)) {
    const resolved = body.property_ids.map((id) => properties.find((p) => p.id === id)).filter(Boolean) as Property[];
    if (resolved.length === 0) badRequest('property_ids', 'A deal must have at least one property.');
    deal.properties = toDealProperties(resolved);
  }
  deal.updated_at = nowIso();
  return deal;
}

function logTransition(deal: Deal, field: string, from: string, to: string, reason: string) {
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
    metadata: { field, from, to },
  } as ActivityLogEntry);
}

function transitionPipeline(deal: Deal, to: PipelineStatus, reason: string): Deal {
  if (!reason?.trim()) badRequest('reason', 'A reason is required for every status transition.');
  const from = deal.pipeline_status;
  if (to === from) badRequest('to_status', 'Deal is already in that pipeline status.');

  if (from === 'on_hold') {
    if (!deal.paused_from_status) badRequest('paused_from_status', 'Cannot resume; paused_from_status is missing.');
    if (to !== 'dead' && to !== deal.paused_from_status) {
      badRequest('to_status', `On-hold deals can only resume to ${deal.paused_from_status} or move to dead.`);
    }
    deal.paused_from_status = null;
  } else {
    if (!PIPELINE_TRANSITIONS[from].includes(to)) {
      badRequest('to_status', `Cannot transition pipeline status from ${from} to ${to}.`);
    }
    if (to === 'on_hold') deal.paused_from_status = from;
  }
  deal.pipeline_status = to;
  deal.updated_at = nowIso();
  logTransition(deal, 'pipeline_status', from, to, reason);
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

function findDeal(id: string): Deal {
  const deal = deals.find((d) => d.id === id);
  if (!deal) throw new ApiError('Not found.', 404, { detail: 'Not found.' });
  return deal;
}

function allowedTransitions(deal: Deal) {
  const pipeline =
    deal.pipeline_status === 'on_hold' && deal.paused_from_status
      ? [deal.paused_from_status, 'dead']
      : PIPELINE_TRANSITIONS[deal.pipeline_status];
  return {
    pipeline_status: pipeline,
    syndication_status: SYNDICATION_TRANSITIONS[deal.syndication_status],
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

    const deal = findDeal(second);
    if (!third) {
      if (method === 'PATCH' || method === 'PUT') return updateDeal(deal, body);
      if (method === 'DELETE') return {};
      return deal;
    }
    if (third === 'allowed-transitions') return allowedTransitions(deal);
    if (third === 'transition') return transitionPipeline(deal, body.to_status as PipelineStatus, String(body.reason ?? ''));
    if (third === 'transition-syndication') {
      return transitionSyndication(deal, body.to_status as SyndicationStatus, String(body.reason ?? ''));
    }
  }

  if (resource === 'documents') {
    const dealId = query.get('deal');
    const filtered = dealId ? documents.filter((d) => d.deal === dealId) : documents;
    return paginate(filtered, query);
  }

  if (resource === 'activity-logs') {
    const dealId = query.get('deal');
    const filtered = dealId ? activity.filter((a) => a.deal === dealId) : activity;
    return paginate(filtered, query);
  }

  if (resource === 'sponsors') {
    if (method === 'POST') return resolveSponsor(body);
    return paginate(sponsors, query);
  }
  if (resource === 'brokers') {
    if (method === 'POST') return resolveBroker(body);
    return paginate(brokers, query);
  }
  if (resource === 'funds') return paginate(funds, query);
  if (resource === 'properties') {
    if (method === 'POST') return resolveProperty(body);
    return paginate(properties, query);
  }

  throw new ApiError(`No mock handler for /${route.join('/')}`, 404, { detail: 'Not found.' });
}
