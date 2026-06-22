// Display metadata for the deal domain. Mirrors api/models/choices.py.
// This is the single source of truth for labels, ordering, and the brass-toned
// stage system shared by the pipeline board, table, badges, and detail header.

import type {
  BrokerStatus,
  DocumentCategory,
  FundStatus,
  InvestmentCategory,
  InvestmentType,
  PipelineStatus,
  PropertyType,
  RelationshipRating,
  SourceChannel,
  SyndicationStatus,
} from '@/types/deal';

export const INVESTMENT_TYPE_LABELS: Record<InvestmentType, string> = {
  whole_loan_bridge: 'Whole loan bridge',
  whole_loan_permanent: 'Whole loan permanent',
  mezzanine: 'Mezzanine',
  preferred_equity: 'Preferred equity',
  co_gp_equity: 'Co-GP equity',
  lp_equity: 'LP equity',
};

export const INVESTMENT_CATEGORY_LABELS: Record<InvestmentCategory, string> = {
  debt: 'Debt',
  hybrid: 'Hybrid',
  equity: 'Equity',
};

export const PIPELINE_STATUS_LABELS: Record<PipelineStatus, string> = {
  sourced: 'Sourced',
  screening: 'Screening',
  quoting: 'Quoting',
  negotiating: 'Negotiating',
  signed: 'Signed',
  closing: 'Closing',
  closed: 'Closed',
  servicing: 'Servicing',
  on_hold: 'On hold',
  dead: 'Dead',
  exited: 'Exited',
};

export const SYNDICATION_STATUS_LABELS: Record<SyndicationStatus, string> = {
  not_started: 'Not syndicated',
  raising: 'Raising',
  fully_subscribed: 'Fully subscribed',
  closed: 'Syndication closed',
};

export const SOURCE_CHANNEL_LABELS: Record<SourceChannel, string> = {
  broker: 'Broker',
  direct: 'Direct',
  referral: 'Referral',
  repeat_sponsor: 'Repeat sponsor',
  internal_prospecting: 'Internal prospecting',
};

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  multifamily: 'Multifamily',
  office: 'Office',
  retail: 'Retail',
  industrial: 'Industrial',
  hotel: 'Hotel',
  self_storage: 'Self storage',
  land: 'Land',
  mixed_use: 'Mixed use',
  data_center: 'Data center',
  condo: 'Condo',
  master_planned_residential: 'Master planned residential',
  other: 'Other',
};

export const RELATIONSHIP_RATING_LABELS: Record<RelationshipRating, string> = {
  new: 'New',
  developing: 'Developing',
  established: 'Established',
  strategic: 'Strategic',
};

export const BROKER_STATUS_LABELS: Record<BrokerStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  blocked: 'Blocked',
};

export const FUND_STATUS_LABELS: Record<FundStatus, string> = {
  forming: 'Forming',
  open: 'Open',
  closed: 'Closed',
};

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  offering_memo: 'Offering memo',
  financials: 'Financials',
  rent_roll: 'Rent roll',
  appraisal: 'Appraisal',
  environmental: 'Environmental',
  title: 'Title',
  insurance: 'Insurance',
  legal: 'Legal',
  entity_docs: 'Entity docs',
  construction: 'Construction',
  investor_docs: 'Investor docs',
  correspondence: 'Correspondence',
  closing_docs: 'Closing docs',
  servicing: 'Servicing',
  other: 'Other',
};

// Workflow ordering. `LINEAR` is the happy path a deal walks (Sourced -> Servicing);
// these are the stages that carry a sequence number on the board. Hold and terminal
// states sit off the path and are deliberately set apart.
export const PIPELINE_LINEAR: PipelineStatus[] = [
  'sourced',
  'screening',
  'quoting',
  'negotiating',
  'signed',
  'closing',
  'closed',
  'servicing',
];

export const PIPELINE_OFF_PATH: PipelineStatus[] = ['on_hold', 'dead', 'exited'];

// Column order for the board: the linear walk, then the off-path lanes.
export const PIPELINE_BOARD_ORDER: PipelineStatus[] = [
  ...PIPELINE_LINEAR,
  ...PIPELINE_OFF_PATH,
];

export type StageKind = 'flow' | 'live' | 'hold' | 'realized' | 'dead';

const STAGE_KIND: Record<PipelineStatus, StageKind> = {
  sourced: 'flow',
  screening: 'flow',
  quoting: 'flow',
  negotiating: 'flow',
  signed: 'flow',
  closing: 'flow',
  closed: 'live',
  servicing: 'live',
  on_hold: 'hold',
  dead: 'dead',
  exited: 'realized',
};

export function stageKind(status: PipelineStatus): StageKind {
  return STAGE_KIND[status];
}

/** 1-based position on the linear path, or null for off-path stages. */
export function pipelineStageNumber(status: PipelineStatus): number | null {
  const index = PIPELINE_LINEAR.indexOf(status);
  return index === -1 ? null : index + 1;
}

// Badge styling keyed to stage semantics. Flow stages ramp from a quiet outline to
// filled brass as the deal advances; live/realized stages read as solid commitments;
// hold and dead read as muted, intentionally lower-energy.
const PIPELINE_BADGE_CLASS: Record<PipelineStatus, string> = {
  sourced: 'border-[var(--border)] bg-[var(--paper)] text-[var(--slate)]',
  screening: 'border-[var(--brass)]/25 bg-[var(--brass)]/8 text-[var(--ink-muted)]',
  quoting: 'border-[var(--brass)]/35 bg-[var(--brass)]/12 text-[var(--ink)]',
  negotiating: 'border-[var(--brass)]/45 bg-[var(--brass)]/16 text-[var(--ink)]',
  signed: 'border-[var(--brass)]/55 bg-[var(--brass)]/22 text-[var(--ink)]',
  closing: 'border-[var(--brass)]/70 bg-[var(--brass)]/30 text-[var(--ink)]',
  closed: 'border-transparent bg-[var(--brass)] text-white',
  servicing: 'border-[var(--brass)]/70 bg-[var(--brass)]/85 text-white',
  exited: 'border-transparent bg-[var(--ink)] text-[var(--paper)]',
  on_hold: 'border-[var(--slate)]/30 bg-[var(--slate)]/10 text-[var(--slate)]',
  dead: 'border-[var(--border)] bg-transparent text-[var(--slate)]/70 line-through decoration-[var(--slate)]/40',
};

export function pipelineBadgeClass(status: PipelineStatus): string {
  return PIPELINE_BADGE_CLASS[status];
}

// Solid accent used for board-column markers and the dot on table rows.
const STAGE_ACCENT: Record<PipelineStatus, string> = {
  sourced: 'var(--slate)',
  screening: 'color-mix(in srgb, var(--brass) 45%, var(--slate))',
  quoting: 'color-mix(in srgb, var(--brass) 60%, var(--slate))',
  negotiating: 'color-mix(in srgb, var(--brass) 75%, var(--slate))',
  signed: 'color-mix(in srgb, var(--brass) 88%, var(--ink))',
  closing: 'var(--brass)',
  closed: 'var(--brass)',
  servicing: 'color-mix(in srgb, var(--brass) 80%, var(--ink))',
  exited: 'var(--ink)',
  on_hold: 'var(--slate)',
  dead: 'color-mix(in srgb, var(--slate) 50%, transparent)',
};

export function stageAccent(status: PipelineStatus): string {
  return STAGE_ACCENT[status];
}

const SYNDICATION_BADGE_CLASS: Record<SyndicationStatus, string> = {
  not_started: 'border-[var(--border)] bg-transparent text-[var(--slate)]/70',
  raising: 'border-[var(--brass)]/40 bg-[var(--brass)]/12 text-[var(--ink)]',
  fully_subscribed: 'border-transparent bg-[var(--brass)]/85 text-white',
  closed: 'border-[var(--ink)]/20 bg-[var(--ink)]/8 text-[var(--ink-muted)]',
};

export function syndicationBadgeClass(status: SyndicationStatus): string {
  return SYNDICATION_BADGE_CLASS[status];
}

// --- Formatters -----------------------------------------------------------

const CURRENCY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const CURRENCY_COMPACT = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 1,
});

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatCurrency(value: string | number | null | undefined): string {
  const parsed = toNumber(value);
  return parsed === null ? '—' : CURRENCY.format(parsed);
}

/** Compact money for dense surfaces, e.g. $4.2M on a deal card. */
export function formatCurrencyCompact(value: string | number | null | undefined): string {
  const parsed = toNumber(value);
  return parsed === null ? '—' : CURRENCY_COMPACT.format(parsed);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
