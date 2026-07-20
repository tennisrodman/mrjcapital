export type DecimalString = string;

export type QuoteStatus =
  | 'draft'
  | 'sent'
  | 'countered'
  | 'executed'
  | 'expired'
  | 'withdrawn';

export type QuoteRateType = '' | 'fixed' | 'floating' | 'hybrid';

export type QuoteAmortizationType = '' | 'interest_only' | 'partial_amort' | 'full_amort';

export type QuoteRecourseType = '' | 'full' | 'limited' | 'non_recourse';

export type QuoteAttachmentSubcategory = 'term_sheet' | 'loi';

export interface QuoteCreatedBy {
  id: number;
  username: string;
}

export interface Quote {
  id: string;
  deal: string;
  version: number;
  is_current: boolean;
  is_send_ready: boolean;
  missing_send_fields: string[];
  status: QuoteStatus;
  is_counter: boolean;
  created_by: number | null;
  created_by_detail: QuoteCreatedBy | null;
  sent_at: string | null;
  expires_at: string | null;
  signed_at: string | null;
  withdrawn_at: string | null;
  notes: string;
  loan_amount: DecimalString | null;
  rate_type: QuoteRateType;
  interest_rate: DecimalString | null;
  index_name: string;
  spread: DecimalString | null;
  rate_floor: DecimalString | null;
  term_months: number | null;
  amortization_type: QuoteAmortizationType;
  amortization_months: number | null;
  origination_fee_pct: DecimalString | null;
  origination_fee_amount: DecimalString | null;
  exit_fee_pct: DecimalString | null;
  extension_options: unknown[];
  prepayment_terms: string;
  recourse_type: QuoteRecourseType;
  recourse_carveouts: string;
  interest_reserve_months: number | null;
  interest_reserve_amount: DecimalString | null;
  holdback_amount: DecimalString | null;
  initial_funding_amount: DecimalString | null;
  good_faith_deposit: DecimalString | null;
  min_dscr: DecimalString | null;
  max_ltv: DecimalString | null;
  min_debt_yield: DecimalString | null;
  equity_commitment: DecimalString | null;
  ownership_pct: DecimalString | null;
  preferred_return_pct: DecimalString | null;
  equity_summary: string;
  attachments: string[];
  created_at: string;
  updated_at: string;
}

/** Writable debt + equity fields on create / draft update. */
export interface QuoteWritableFields {
  notes: string;
  loan_amount: DecimalString | null;
  rate_type: QuoteRateType;
  interest_rate: DecimalString | null;
  index_name: string;
  spread: DecimalString | null;
  rate_floor: DecimalString | null;
  term_months: number | null;
  amortization_type: QuoteAmortizationType;
  amortization_months: number | null;
  origination_fee_pct: DecimalString | null;
  exit_fee_pct: DecimalString | null;
  extension_options: unknown[];
  prepayment_terms: string;
  recourse_type: QuoteRecourseType;
  recourse_carveouts: string;
  interest_reserve_months: number | null;
  interest_reserve_amount: DecimalString | null;
  holdback_amount: DecimalString | null;
  good_faith_deposit: DecimalString | null;
  min_dscr: DecimalString | null;
  max_ltv: DecimalString | null;
  min_debt_yield: DecimalString | null;
  equity_commitment: DecimalString | null;
  ownership_pct: DecimalString | null;
  preferred_return_pct: DecimalString | null;
  equity_summary: string;
  expires_at?: string | null;
}

export interface CreateQuotePayload extends Partial<QuoteWritableFields> {
  deal: string;
  seed_from_screening?: boolean;
}

export type UpdateQuotePayload = Partial<QuoteWritableFields>;

export interface SendQuotePayload {
  expires_at?: string | null;
}

export interface QuoteAttachmentsPayload {
  document_ids: string[];
}

/** UI-only controlled form values (empty string = unset). */
export interface QuoteFormValues {
  notes: string;
  loan_amount: string;
  rate_type: QuoteRateType;
  interest_rate: string;
  index_name: string;
  spread: string;
  rate_floor: string;
  term_months: string;
  amortization_type: QuoteAmortizationType;
  amortization_months: string;
  origination_fee_pct: string;
  exit_fee_pct: string;
  extension_terms: string;
  prepayment_terms: string;
  recourse_type: QuoteRecourseType;
  recourse_carveouts: string;
  interest_reserve_months: string;
  interest_reserve_amount: string;
  holdback_amount: string;
  good_faith_deposit: string;
  min_dscr: string;
  max_ltv: string;
  min_debt_yield: string;
  expires_on: string;
  equity_commitment: string;
  ownership_pct: string;
  preferred_return_pct: string;
  equity_summary: string;
}

export const ATTACHMENT_EDITABLE_STATUSES: QuoteStatus[] = ['draft', 'sent', 'countered'];

export const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  countered: 'Countered',
  executed: 'Executed',
  expired: 'Expired',
  withdrawn: 'Withdrawn',
};
