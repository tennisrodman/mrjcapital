// In-memory mock API. Routes path + method to fixture data and mirrors the
// backend's transition rules and nested-write create contract closely enough to
// exercise every view. State lives for the page session and resets on reload.

import { ApiError } from '@/lib/apiError';
import { calculateDebtMetrics } from '@/components/deals/screening/calculations';
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

function requireEmail(data: Record<string, unknown>, field: string, errorField = field): string {
  const value = requireString(data, field, errorField);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) badRequest(errorField, `${field} must be a valid email.`);
  return value;
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
  const created: Sponsor = {
    id: newId('sp'),
    entity_name: requireString(input, 'entity_name', 'sponsor'),
    entity_type: requireString(input, 'entity_type', 'sponsor') as Sponsor['entity_type'],
    primary_contact_name: requireString(input, 'primary_contact_name', 'sponsor'),
    primary_contact_email: requireEmail(input, 'primary_contact_email', 'sponsor'),
    primary_contact_phone: stringValue(input.primary_contact_phone),
    relationship_rating: (stringValue(input.relationship_rating) || 'new') as Sponsor['relationship_rating'],
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

function resolveProperty(input: unknown): Property {
  if (typeof input === 'string') {
    const existing = properties.find((p) => p.id === input);
    if (!existing) badRequest('properties', 'Selected property no longer exists.');
    return existing!;
  }
  if (!isObject(input)) badRequest('properties', 'Expected an existing property id or an object.');
  const address = requireString(input, 'address', 'properties');
  const city = requireString(input, 'city', 'properties');
  const state = requireString(input, 'state', 'properties').toUpperCase();
  const zip = requireString(input, 'zip', 'properties');
  const propertyType = requireString(input, 'property_type', 'properties') as Property['property_type'];
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
    msa: stringValue(input.msa),
    details: {},
  };
  properties.push(created);
  return created;
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
  const investmentType = body.investment_type as InvestmentType;

  const deal: Deal = {
    id: newId('deal'),
    name: String(body.name ?? 'Untitled deal'),
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
    source_channel: body.source_channel as Deal['source_channel'],
    source_date: String(body.source_date ?? nowIso().slice(0, 10)),
    requested_amount: String(body.requested_amount ?? '0'),
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
  if (typeof body.name === 'string') deal.name = body.name;
  if (typeof body.investment_type === 'string') {
    deal.investment_type = body.investment_type as InvestmentType;
    deal.investment_category = deriveCategory(deal.investment_type);
  }
  if (body.requested_amount !== undefined) deal.requested_amount = String(body.requested_amount);
  if (typeof body.source_channel === 'string') deal.source_channel = body.source_channel as Deal['source_channel'];
  if (typeof body.source_date === 'string') deal.source_date = body.source_date;
  if ('sponsor' in body) {
    const sponsor = resolveExistingSponsor(body.sponsor);
    if (deal.sponsor && sponsor?.id !== deal.sponsor) {
      badRequest('sponsor', 'This relationship cannot be changed through this endpoint.');
    }
    if (!deal.sponsor && sponsor) {
      deal.sponsor = sponsor.id;
      deal.sponsor_detail = sponsor;
    }
  }
  if ('broker' in body) {
    const broker = resolveExistingBroker(body.broker);
    if (deal.broker && broker?.id !== deal.broker) {
      badRequest('broker', 'This relationship cannot be changed through this endpoint.');
    }
    if (!deal.broker && broker) {
      deal.broker = broker.id;
      deal.broker_detail = broker;
    }
  }
  if ('fund' in body) {
    const fund = resolveFund(body.fund);
    if (deal.fund && fund?.id !== deal.fund) {
      badRequest('fund', 'This relationship cannot be changed through this endpoint.');
    }
    if (!deal.fund && fund) {
      deal.fund = fund.id;
      deal.fund_detail = fund;
    }
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
    is_override: false,
  });
  deal.pipeline_status = to;
  deal.current_stage_entered_at = transitionedAt;
  deal.days_in_current_stage = 0;
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
    annual_debt_service: nullableDecimal('annual_debt_service'),
    occupancy,
    proposed_rate: proposedRate,
    proposed_term_months: positiveInteger('proposed_term_months'),
    equity_summary: String(body.equity_summary ?? ''),
    equity_target_irr: nullableDecimal('equity_target_irr'),
    equity_target_multiple: nullableDecimal('equity_target_multiple'),
    equity_target_hold_months: positiveInteger('equity_target_hold_months'),
    decision: decision as ScreeningAssessment['decision'],
    notes: String(body.notes ?? ''),
  };
}

function createScreeningAssessment(body: Record<string, unknown>): ScreeningAssessment {
  const input = screeningInput(body);
  findDeal(input.deal);
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
  const assessment: ScreeningAssessment = {
    id: newId('screen'),
    ...input,
    ...metrics,
    version,
    is_current: true,
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
  const input = screeningInput({ ...assessment, ...body, deal: assessment.deal });
  Object.assign(assessment, input, calculateDebtMetrics(input), { updated_at: nowIso() });
  return assessment;
}

function finalizeScreeningAssessment(
  assessment: ScreeningAssessment,
  body: Record<string, unknown>,
): ScreeningAssessment {
  if (assessment.status === 'finalized') {
    badRequest('status', 'Only draft screening assessments can be changed.');
  }
  const decision = String(body.decision ?? '');
  if (!['advance', 'refer', 'decline'].includes(decision)) {
    badRequest('decision', 'Select a supported screening decision.');
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
    if (third === 'stage-history') {
      const filtered = stageEvents
        .filter((event) => event.deal === deal.id)
        .sort((a, b) => b.entered_at.localeCompare(a.entered_at));
      return paginate(filtered, query);
    }
    if (third === 'transition') return transitionPipeline(deal, body.to_status as PipelineStatus, String(body.reason ?? ''));
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
      const currentOnly = query.get('current') === 'true';
      const filtered = screeningAssessments.filter(
        (assessment) =>
          (!dealId || assessment.deal === dealId) && (!currentOnly || assessment.is_current),
      );
      return paginate(filtered, query);
    }
    const assessment = findScreeningAssessment(second);
    if (third === 'finalize' && method === 'POST') {
      return finalizeScreeningAssessment(assessment, body);
    }
    if (method === 'PATCH' || method === 'PUT') return updateScreeningAssessment(assessment, body);
    if (method === 'DELETE') {
      if (assessment.status === 'finalized') {
        badRequest('status', 'Finalized screening assessments cannot be deleted.');
      }
      screeningAssessments.splice(screeningAssessments.indexOf(assessment), 1);
      return {};
    }
    return assessment;
  }

  if (resource === 'contacts') {
    if (!second && method === 'POST') return createContact(body);
    return paginate(contacts, query);
  }

  if (resource === 'deal-contacts') {
    if (!second && method === 'POST') return createDealContact(body);
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
