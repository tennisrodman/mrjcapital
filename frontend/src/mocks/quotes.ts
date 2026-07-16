// In-memory quote / term-sheet store for Demo mode. Mirrors api/services/quotes.py.

import { ApiError } from '@/lib/apiError';
import type { Deal, DealDocument, Paginated } from '@/types/deal';
import type {
  Quote,
  QuoteAmortizationType,
  QuoteRateType,
  QuoteRecourseType,
  QuoteStatus,
  QuoteWritableFields,
} from '@/types/quote';

const QUOTE_PIPELINE_STATUSES = new Set(['quoting', 'negotiating']);
const ATTACHMENT_EDITABLE = new Set<QuoteStatus>(['draft', 'sent', 'countered']);
const SENDABLE_FROM = new Set<QuoteStatus>(['draft']);
const EXECUTABLE_FROM = new Set<QuoteStatus>(['sent', 'countered']);
const COUNTERABLE_FROM = new Set<QuoteStatus>(['sent', 'countered']);
const WITHDRAWABLE_FROM = new Set<QuoteStatus>(['draft', 'sent', 'countered']);
const EXPIRABLE_FROM = new Set<QuoteStatus>(['sent', 'countered']);
const TERMINAL = new Set<QuoteStatus>(['executed', 'expired', 'withdrawn']);
const RATE_TYPES = new Set(['', 'fixed', 'floating', 'hybrid']);
const AMORT_TYPES = new Set(['', 'interest_only', 'partial_amort', 'full_amort']);
const RECOURSE_TYPES = new Set(['', 'full', 'limited', 'non_recourse']);
const QUOTE_SUBCATEGORIES = new Set(['term_sheet', 'loi']);

const EDITABLE_FIELDS = new Set([
  'notes',
  'loan_amount',
  'rate_type',
  'interest_rate',
  'index_name',
  'spread',
  'rate_floor',
  'term_months',
  'amortization_type',
  'amortization_months',
  'origination_fee_pct',
  'exit_fee_pct',
  'extension_options',
  'prepayment_terms',
  'recourse_type',
  'recourse_carveouts',
  'interest_reserve_months',
  'interest_reserve_amount',
  'holdback_amount',
  'good_faith_deposit',
  'min_dscr',
  'max_ltv',
  'min_debt_yield',
  'equity_commitment',
  'ownership_pct',
  'preferred_return_pct',
  'equity_summary',
  'expires_at',
]);

const COPY_ON_COUNTER = [
  'notes',
  'loan_amount',
  'rate_type',
  'interest_rate',
  'index_name',
  'spread',
  'rate_floor',
  'term_months',
  'amortization_type',
  'amortization_months',
  'origination_fee_pct',
  'exit_fee_pct',
  'extension_options',
  'prepayment_terms',
  'recourse_type',
  'recourse_carveouts',
  'interest_reserve_months',
  'interest_reserve_amount',
  'holdback_amount',
  'good_faith_deposit',
  'min_dscr',
  'max_ltv',
  'min_debt_yield',
  'equity_commitment',
  'ownership_pct',
  'preferred_return_pct',
  'equity_summary',
] as const;

const quotes: Quote[] = [];
let idCounter = 7000;

export type ScreeningSeed = {
  loan_amount: string | null;
  interest_rate: string | null;
  term_months: number | null;
};

export type QuotesHandlerDeps = {
  method: string;
  second?: string;
  third?: string;
  query: URLSearchParams;
  body: Record<string, unknown>;
  findDeal: (id: string) => Deal;
  findDocument: (id: string) => DealDocument;
  paginate: <T>(items: T[], query: URLSearchParams) => Paginated<T>;
  getScreeningSeed?: (dealId: string) => ScreeningSeed | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function newId(): string {
  return `quote-${idCounter++}`;
}

function badRequest(field: string, message: string): never {
  throw new ApiError(message, 400, { [field]: [message] });
}

function nullableDecimal(body: Record<string, unknown>, field: string): string | null {
  const raw = body[field];
  if (raw === null || raw === undefined || raw === '') return null;
  const value = String(raw);
  if (!/^\d+(?:\.\d+)?$/.test(value)) badRequest(field, 'Enter a valid non-negative decimal.');
  return value;
}

function nullableInt(body: Record<string, unknown>, field: string): number | null {
  const raw = body[field];
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    badRequest(field, 'Enter a positive whole number.');
  }
  return value;
}

function quantizeMoney(value: number): string {
  return value.toFixed(2);
}

function applyCalculated(quote: Quote): void {
  const loan = quote.loan_amount !== null ? Number(quote.loan_amount) : null;
  const feePct = quote.origination_fee_pct !== null ? Number(quote.origination_fee_pct) : null;
  const holdback = quote.holdback_amount !== null ? Number(quote.holdback_amount) : null;

  if (loan !== null && holdback !== null && holdback > loan) {
    badRequest('holdback_amount', 'Holdback cannot exceed the loan amount.');
  }

  if (loan !== null && feePct !== null) {
    quote.origination_fee_amount = quantizeMoney((loan * feePct) / 100);
  } else {
    quote.origination_fee_amount = null;
  }

  if (loan !== null && holdback !== null) {
    quote.initial_funding_amount = quantizeMoney(loan - holdback);
  } else {
    quote.initial_funding_amount = null;
  }
}

function requireQuotePipeline(deal: Deal): void {
  if (!QUOTE_PIPELINE_STATUSES.has(deal.pipeline_status)) {
    badRequest(
      'deal',
      'Quote actions are only allowed while the deal is in quoting or negotiating.',
    );
  }
}

function parseWritable(
  body: Record<string, unknown>,
  base?: Partial<QuoteWritableFields>,
): QuoteWritableFields {
  const source = { ...(base ?? {}), ...body } as Record<string, unknown>;
  const rateType = String(source.rate_type ?? '');
  if (!RATE_TYPES.has(rateType)) badRequest('rate_type', 'Select a supported rate type.');
  const amortType = String(source.amortization_type ?? '');
  if (!AMORT_TYPES.has(amortType)) {
    badRequest('amortization_type', 'Select a supported amortization type.');
  }
  const recourseType = String(source.recourse_type ?? '');
  if (!RECOURSE_TYPES.has(recourseType)) {
    badRequest('recourse_type', 'Select a supported recourse type.');
  }

  let expiresAt: string | null | undefined;
  if ('expires_at' in source) {
    const raw = source.expires_at;
    expiresAt = raw === null || raw === undefined || raw === '' ? null : String(raw);
  }

  return {
    notes: String(source.notes ?? ''),
    loan_amount: nullableDecimal(source, 'loan_amount'),
    rate_type: rateType as QuoteRateType,
    interest_rate: nullableDecimal(source, 'interest_rate'),
    index_name: String(source.index_name ?? ''),
    spread: nullableDecimal(source, 'spread'),
    rate_floor: nullableDecimal(source, 'rate_floor'),
    term_months: nullableInt(source, 'term_months'),
    amortization_type: amortType as QuoteAmortizationType,
    amortization_months: nullableInt(source, 'amortization_months'),
    origination_fee_pct: nullableDecimal(source, 'origination_fee_pct'),
    exit_fee_pct: nullableDecimal(source, 'exit_fee_pct'),
    extension_options: Array.isArray(source.extension_options) ? source.extension_options : [],
    prepayment_terms: String(source.prepayment_terms ?? ''),
    recourse_type: recourseType as QuoteRecourseType,
    recourse_carveouts: String(source.recourse_carveouts ?? ''),
    interest_reserve_months:
      source.interest_reserve_months === null ||
      source.interest_reserve_months === undefined ||
      source.interest_reserve_months === ''
        ? null
        : Number(source.interest_reserve_months),
    interest_reserve_amount: nullableDecimal(source, 'interest_reserve_amount'),
    holdback_amount: nullableDecimal(source, 'holdback_amount'),
    good_faith_deposit: nullableDecimal(source, 'good_faith_deposit'),
    min_dscr: nullableDecimal(source, 'min_dscr'),
    max_ltv: nullableDecimal(source, 'max_ltv'),
    min_debt_yield: nullableDecimal(source, 'min_debt_yield'),
    equity_commitment: nullableDecimal(source, 'equity_commitment'),
    ownership_pct: nullableDecimal(source, 'ownership_pct'),
    preferred_return_pct: nullableDecimal(source, 'preferred_return_pct'),
    equity_summary: String(source.equity_summary ?? ''),
    ...(expiresAt !== undefined ? { expires_at: expiresAt } : {}),
  };
}

function getCurrent(dealId: string): Quote | undefined {
  return quotes
    .filter((quote) => quote.deal === dealId)
    .sort((a, b) => b.version - a.version)[0];
}

function requireCurrent(quote: Quote): void {
  if (quotes.some((row) => row.deal === quote.deal && row.version > quote.version)) {
    badRequest('status', 'Only the current quote version can be used.');
  }
}

function findQuote(id: string): Quote {
  const quote = quotes.find((row) => row.id === id);
  if (!quote) throw new ApiError('Not found.', 404, { detail: 'Not found.' });
  return quote;
}

function emptyWritable(): QuoteWritableFields {
  return {
    notes: '',
    loan_amount: null,
    rate_type: '',
    interest_rate: null,
    index_name: '',
    spread: null,
    rate_floor: null,
    term_months: null,
    amortization_type: '',
    amortization_months: null,
    origination_fee_pct: null,
    exit_fee_pct: null,
    extension_options: [],
    prepayment_terms: '',
    recourse_type: '',
    recourse_carveouts: '',
    interest_reserve_months: null,
    interest_reserve_amount: null,
    holdback_amount: null,
    good_faith_deposit: null,
    min_dscr: null,
    max_ltv: null,
    min_debt_yield: null,
    equity_commitment: null,
    ownership_pct: null,
    preferred_return_pct: null,
    equity_summary: '',
  };
}

export function getCurrentQuote(dealId: string): Quote | undefined {
  return getCurrent(dealId);
}

export function createQuote(
  body: Record<string, unknown>,
  deps: Pick<QuotesHandlerDeps, 'findDeal' | 'getScreeningSeed'>,
  options: { isCounter?: boolean } = {},
): Quote {
  const dealId = String(body.deal ?? '');
  if (!dealId) badRequest('deal', 'A deal is required to create a quote.');
  const deal = deps.findDeal(dealId);
  if (!QUOTE_PIPELINE_STATUSES.has(deal.pipeline_status)) {
    badRequest(
      'deal',
      'Quote actions are only allowed while the deal is in quoting or negotiating.',
    );
  }

  const current = getCurrent(dealId);
  if (current?.status === 'draft') {
    badRequest('status', 'Update, send, or withdraw the current draft before starting a new version.');
  }
  if (current && !TERMINAL.has(current.status) && !options.isCounter) {
    badRequest(
      'status',
      'Use counter to revise an active quote, or wait until the current version is terminal.',
    );
  }

  const seedFromScreening = body.seed_from_screening !== false;
  const hasFieldPayload = Object.keys(body).some(
    (key) => key !== 'deal' && key !== 'seed_from_screening' && EDITABLE_FIELDS.has(key),
  );

  let fields = emptyWritable();
  if (hasFieldPayload || options.isCounter) {
    fields = parseWritable(body);
  } else if (seedFromScreening && deps.getScreeningSeed) {
    const seed = deps.getScreeningSeed(dealId);
    if (seed) {
      fields.loan_amount = seed.loan_amount;
      fields.interest_rate = seed.interest_rate;
      fields.term_months = seed.term_months;
    }
  }

  for (const quote of quotes) {
    if (quote.deal === dealId) quote.is_current = false;
  }

  const iso = nowIso();
  const quote: Quote = {
    id: newId(),
    deal: dealId,
    version: (current?.version ?? 0) + 1,
    is_current: true,
    is_send_ready: false,
    missing_send_fields: [],
    status: 'draft',
    is_counter: Boolean(options.isCounter),
    created_by: 1,
    created_by_detail: { id: 1, username: 'tchen' },
    sent_at: null,
    expires_at: fields.expires_at ?? null,
    signed_at: null,
    withdrawn_at: null,
    notes: fields.notes,
    loan_amount: fields.loan_amount,
    rate_type: fields.rate_type,
    interest_rate: fields.interest_rate,
    index_name: fields.index_name,
    spread: fields.spread,
    rate_floor: fields.rate_floor,
    term_months: fields.term_months,
    amortization_type: fields.amortization_type,
    amortization_months: fields.amortization_months,
    origination_fee_pct: fields.origination_fee_pct,
    origination_fee_amount: null,
    exit_fee_pct: fields.exit_fee_pct,
    extension_options: fields.extension_options,
    prepayment_terms: fields.prepayment_terms,
    recourse_type: fields.recourse_type,
    recourse_carveouts: fields.recourse_carveouts,
    interest_reserve_months: fields.interest_reserve_months,
    interest_reserve_amount: fields.interest_reserve_amount,
    holdback_amount: fields.holdback_amount,
    initial_funding_amount: null,
    good_faith_deposit: fields.good_faith_deposit,
    min_dscr: fields.min_dscr,
    max_ltv: fields.max_ltv,
    min_debt_yield: fields.min_debt_yield,
    equity_commitment: fields.equity_commitment,
    ownership_pct: fields.ownership_pct,
    preferred_return_pct: fields.preferred_return_pct,
    equity_summary: fields.equity_summary,
    attachments: [],
    created_at: iso,
    updated_at: iso,
  };
  applyCalculated(quote);
  refreshSendReadiness(quote);
  quotes.unshift(quote);
  return quote;
}

export function updateQuote(
  quote: Quote,
  body: Record<string, unknown>,
  findDeal: (id: string) => Deal,
): Quote {
  requireQuotePipeline(findDeal(quote.deal));
  if (quote.status !== 'draft') {
    badRequest('status', 'Non-draft quotes are immutable.');
  }
  requireCurrent(quote);
  if ('deal' in body && String(body.deal) !== quote.deal) {
    badRequest('deal', 'A quote cannot be moved to another deal.');
  }
  for (const key of Object.keys(body)) {
    if (key === 'deal' || key === 'seed_from_screening') continue;
    if (!EDITABLE_FIELDS.has(key)) {
      badRequest(key, 'This field cannot be updated on a quote draft.');
    }
  }

  const fields = parseWritable(body, quote);
  Object.assign(quote, fields, { updated_at: nowIso() });
  applyCalculated(quote);
  refreshSendReadiness(quote);
  return quote;
}

export function sendQuote(
  quote: Quote,
  body: Record<string, unknown>,
  findDeal: (id: string) => Deal,
): Quote {
  requireQuotePipeline(findDeal(quote.deal));
  requireCurrent(quote);
  if (!SENDABLE_FROM.has(quote.status)) {
    badRequest('status', 'Only draft quotes can be sent.');
  }
  if ('expires_at' in body) {
    const raw = body.expires_at;
    quote.expires_at = raw === null || raw === undefined || raw === '' ? null : String(raw);
  }
  refreshSendReadiness(quote);
  if (!quote.is_send_ready) {
    badRequest('detail', `Complete required quote terms: ${quote.missing_send_fields.join(', ')}.`);
  }
  if (quote.expires_at && new Date(quote.expires_at).getTime() <= Date.now()) {
    badRequest('expires_at', 'Expiration must be in the future.');
  }
  quote.sent_at = nowIso();
  quote.status = quote.is_counter ? 'countered' : 'sent';
  quote.updated_at = nowIso();
  return quote;
}

function refreshSendReadiness(quote: Quote): void {
  const required: Array<keyof Quote> = [
    'loan_amount',
    'rate_type',
    'term_months',
    'amortization_type',
    'recourse_type',
    'expires_at',
  ];
  const missing = required.filter((field) => quote[field] === null || quote[field] === '');
  if (quote.loan_amount !== null && Number(quote.loan_amount) <= 0) missing.push('loan_amount');
  if (quote.rate_type === 'fixed' && quote.interest_rate === null) missing.push('interest_rate');
  if (quote.rate_type === 'floating' || quote.rate_type === 'hybrid') {
    if (!quote.index_name.trim()) missing.push('index_name');
    if (quote.spread === null) missing.push('spread');
  }
  if (
    (quote.amortization_type === 'partial_amort' || quote.amortization_type === 'full_amort')
    && quote.amortization_months === null
  ) {
    missing.push('amortization_months');
  }
  quote.missing_send_fields = Array.from(new Set(missing));
  quote.is_send_ready = missing.length === 0;
}

export function counterQuote(
  quote: Quote,
  deps: Pick<QuotesHandlerDeps, 'findDeal' | 'getScreeningSeed'>,
): Quote {
  requireQuotePipeline(deps.findDeal(quote.deal));
  requireCurrent(quote);
  if (!COUNTERABLE_FROM.has(quote.status)) {
    badRequest('status', 'Only the current sent or countered quote can be countered.');
  }
  const copied: Record<string, unknown> = { deal: quote.deal, seed_from_screening: false };
  for (const field of COPY_ON_COUNTER) {
    copied[field] = quote[field];
  }
  return createQuote(copied, deps, { isCounter: true });
}

export function executeQuote(
  quote: Quote,
  findDocument: (id: string) => DealDocument,
  findDeal: (id: string) => Deal,
): Quote {
  requireQuotePipeline(findDeal(quote.deal));
  requireCurrent(quote);
  if (!EXECUTABLE_FROM.has(quote.status)) {
    badRequest('status', 'Only the current sent or countered quote can be executed.');
  }
  const readyDocs: DealDocument[] = [];
  for (const documentId of quote.attachments) {
    try {
      const document = findDocument(documentId);
      if (
        document.storage_status === 'ready' &&
        document.category === 'legal' &&
        QUOTE_SUBCATEGORIES.has(document.subcategory ?? '')
      ) {
        readyDocs.push(document);
      }
    } catch {
      // skip missing
    }
  }
  if (readyDocs.length === 0) {
    badRequest(
      'attachments',
      'Attach at least one ready legal term sheet or LOI document before executing.',
    );
  }
  for (const document of readyDocs) {
    document.is_executed = true;
  }
  quote.signed_at = nowIso();
  quote.status = 'executed';
  quote.updated_at = quote.signed_at;
  return quote;
}

export function withdrawQuote(quote: Quote, findDeal: (id: string) => Deal): Quote {
  requireQuotePipeline(findDeal(quote.deal));
  requireCurrent(quote);
  if (!WITHDRAWABLE_FROM.has(quote.status)) {
    badRequest('status', 'This quote cannot be withdrawn.');
  }
  quote.withdrawn_at = nowIso();
  quote.status = 'withdrawn';
  quote.updated_at = quote.withdrawn_at;
  return quote;
}

export function expireQuote(quote: Quote, findDeal: (id: string) => Deal): Quote {
  requireQuotePipeline(findDeal(quote.deal));
  requireCurrent(quote);
  if (!EXPIRABLE_FROM.has(quote.status)) {
    badRequest('status', 'Only sent or countered quotes can be expired.');
  }
  quote.status = 'expired';
  quote.updated_at = nowIso();
  return quote;
}

export function setQuoteAttachments(
  quote: Quote,
  body: Record<string, unknown>,
  findDocument: (id: string) => DealDocument,
  findDeal: (id: string) => Deal,
): Quote {
  requireQuotePipeline(findDeal(quote.deal));
  requireCurrent(quote);
  if (!ATTACHMENT_EDITABLE.has(quote.status)) {
    badRequest('status', 'Attachments can only be changed on draft, sent, or countered quotes.');
  }
  if (!Array.isArray(body.document_ids)) {
    badRequest('document_ids', 'Expected a list of document ids.');
  }
  const documentIds = body.document_ids.map((value) => String(value));
  const documents = documentIds.map((documentId) => {
    let document: DealDocument;
    try {
      document = findDocument(documentId);
    } catch {
      badRequest('document_ids', 'One or more documents are missing or not on this deal.');
    }
    if (document.deal !== quote.deal) {
      badRequest('document_ids', 'One or more documents are missing or not on this deal.');
    }
    if (document.storage_status !== 'ready') {
      badRequest('document_ids', 'One or more documents are missing or not on this deal.');
    }
    if (document.category !== 'legal') {
      badRequest('document_ids', 'Quote attachments must use the legal document category.');
    }
    if (!QUOTE_SUBCATEGORIES.has(document.subcategory ?? '')) {
      badRequest('document_ids', 'Quote attachments must use subcategory term_sheet or loi.');
    }
    return document;
  });
  quote.attachments = documents.map((document) => document.id);
  quote.updated_at = nowIso();
  return quote;
}

/** True when a document id is attached to an executed quote. */
export function documentIsExecutedQuoteEvidence(documentId: string): boolean {
  return quotes.some(
    (quote) => quote.status === 'executed' && quote.attachments.includes(documentId),
  );
}

export function listQuotesForDeal(dealId: string | null, status: string | null, currentOnly: boolean | null): Quote[] {
  return quotes.filter(
    (quote) =>
      (!dealId || quote.deal === dealId) &&
      (!status || quote.status === status) &&
      (currentOnly === null || quote.is_current === currentOnly),
  );
}

/** Main entry for handlers.ts — routes method/path segments onto the quote store. */
export function handleQuotesRequest(deps: QuotesHandlerDeps): unknown {
  const { method, second, third, query, body } = deps;

  if (!second) {
    if (method === 'POST') return createQuote(body, deps);
    const dealId = query.get('deal');
    const status = query.get('status');
    if (status && !['draft', 'sent', 'countered', 'executed', 'expired', 'withdrawn'].includes(status)) {
      badRequest('status', 'Unsupported quote status.');
    }
    const currentFilter = query.get('current');
    if (
      currentFilter !== null &&
      !['true', 'false', '1', '0'].includes(currentFilter.toLowerCase())
    ) {
      badRequest('current', 'Expected true or false.');
    }
    const currentOnly =
      currentFilter === null ? null : ['true', '1'].includes(currentFilter.toLowerCase());
    return deps.paginate(listQuotesForDeal(dealId, status, currentOnly), query);
  }

  const quote = findQuote(second);

  if (third === 'send' && method === 'POST') return sendQuote(quote, body, deps.findDeal);
  if (third === 'counter' && method === 'POST') return counterQuote(quote, deps);
  if (third === 'execute' && method === 'POST') {
    return executeQuote(quote, deps.findDocument, deps.findDeal);
  }
  if (third === 'withdraw' && method === 'POST') return withdrawQuote(quote, deps.findDeal);
  if (third === 'expire' && method === 'POST') return expireQuote(quote, deps.findDeal);
  if (third === 'attachments' && method === 'POST') {
    return setQuoteAttachments(quote, body, deps.findDocument, deps.findDeal);
  }
  if (method === 'PATCH' || method === 'PUT') return updateQuote(quote, body, deps.findDeal);
  if (method === 'DELETE') {
    badRequest('status', 'Quote versions cannot be deleted; create a new version instead.');
  }
  return quote;
}

/** Test helper — clear store between suites if needed. */
export function resetQuotesStore(): void {
  quotes.length = 0;
}
