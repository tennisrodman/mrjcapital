export type DecimalString = string;

export type ScreeningAssessmentStatus = 'draft' | 'finalized';
export type ScreeningDecision = '' | 'advance' | 'refer' | 'decline';
export type FinalScreeningDecision = Exclude<ScreeningDecision, ''>;

export interface DebtScreeningOutputs {
  /** Ratios are fractional decimal strings: "0.6500" means 65%. */
  ltv_as_is: DecimalString | null;
  ltv_stabilized: DecimalString | null;
  ltc: DecimalString | null;
  dscr: DecimalString | null;
  debt_yield: DecimalString | null;
  quick_score: number;
}

export interface ScreeningReviewer {
  id: number;
  username: string;
}

export interface ScreeningAssessment extends DebtScreeningOutputs {
  id: string;
  deal: string;
  version: number;
  is_current: boolean;
  status: ScreeningAssessmentStatus;
  reviewer: number | null;
  reviewer_detail: ScreeningReviewer | null;
  finalized_at: string | null;
  decision: ScreeningDecision;
  notes: string;
  loan_amount: DecimalString | null;
  as_is_value: DecimalString | null;
  stabilized_value: DecimalString | null;
  project_cost: DecimalString | null;
  noi: DecimalString | null;
  annual_debt_service: DecimalString | null;
  occupancy: DecimalString | null;
  proposed_rate: DecimalString | null;
  proposed_term_months: number | null;
  max_ltv: DecimalString;
  max_ltc: DecimalString;
  min_dscr: DecimalString;
  min_debt_yield: DecimalString;
  equity_summary: string;
  equity_target_irr: DecimalString | null;
  equity_target_multiple: DecimalString | null;
  equity_target_hold_months: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreateScreeningAssessmentPayload {
  deal: string;
  loan_amount: DecimalString | null;
  as_is_value: DecimalString | null;
  stabilized_value: DecimalString | null;
  project_cost: DecimalString | null;
  noi: DecimalString | null;
  annual_debt_service: DecimalString | null;
  occupancy: DecimalString | null;
  proposed_rate: DecimalString | null;
  proposed_term_months: number | null;
  equity_summary: string;
  equity_target_irr: DecimalString | null;
  equity_target_multiple: DecimalString | null;
  equity_target_hold_months: number | null;
  decision: ScreeningDecision;
  notes: string;
}

export type UpdateScreeningAssessmentPayload = Omit<CreateScreeningAssessmentPayload, 'deal'>;

export interface FinalizeScreeningAssessmentPayload {
  decision: FinalScreeningDecision;
  notes?: string;
}

/** UI-only values; API conversion happens once when the form is submitted. */
export interface ScreeningAssessmentFormValues {
  loan_amount: string;
  as_is_value: string;
  stabilized_value: string;
  project_cost: string;
  noi: string;
  annual_debt_service: string;
  occupancy: string;
  proposed_rate: string;
  proposed_term_months: string;
  equity_summary: string;
  equity_target_irr: string;
  equity_target_multiple: string;
  equity_target_hold_months: string;
  decision: ScreeningDecision;
  notes: string;
}
