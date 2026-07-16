export type DDItemStatus = 'pending' | 'in_progress' | 'complete' | 'waived';
export type CPItemStatus = 'open' | 'satisfied' | 'waived';
export type TemplateItemKind = 'dd' | 'cp';

export interface ClosingAssignee {
  id: number;
  username: string;
}

export interface DDTemplateItem {
  id: string;
  sort_order: number;
  kind: TemplateItemKind;
  title: string;
  description: string;
  default_days_before_target_close: number | null;
}

export interface DDTemplate {
  id: string;
  key: string;
  name: string;
  description: string;
  is_active: boolean;
  items: DDTemplateItem[];
}

export interface ClosingPackage {
  id: string;
  deal: string;
  target_close_date: string | null;
  actual_close_date: string | null;
  funds_wired_date: string | null;
  funds_wired_amount: string | null;
  closing_attorney: string;
  title_company: string;
  purchase_price: string | null;
  appraised_value: string | null;
  final_loan_amount: string | null;
  closing_costs: string | null;
  sources_and_uses_notes: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface ClosingGeneration {
  id: string;
  package: string;
  version: number;
  template: string | null;
  template_key: string;
  template_name: string;
  is_current: boolean;
  generated_at: string;
  generated_by: number | null;
  superseded_at: string | null;
  superseded_by: number | null;
  supersede_reason: string;
}

export interface ClosingDocumentSummary {
  id: string;
  document_name: string;
  category: string;
  subcategory?: string;
  storage_status: string;
  file_type: string;
  file_size_bytes: number | null;
  /** Present in Demo for invisible-doc union parity with Live. */
  visibility_roles?: string[];
}

export interface DDChecklistItem {
  id: string;
  generation: string;
  source_template_item: string | null;
  sort_order: number;
  title: string;
  description: string;
  status: DDItemStatus;
  owner: number | null;
  owner_detail?: ClosingAssignee | null;
  due_date: string | null;
  waiver_reason: string;
  completed_at: string | null;
  waived_at: string | null;
  documents: ClosingDocumentSummary[];
  created_at: string;
  updated_at: string;
}

export interface ConditionPrecedent {
  id: string;
  generation: string;
  source_template_item: string | null;
  sort_order: number;
  title: string;
  description: string;
  status: CPItemStatus;
  owner: number | null;
  owner_detail?: ClosingAssignee | null;
  due_date: string | null;
  waiver_reason: string;
  satisfied_at: string | null;
  waived_at: string | null;
  documents: ClosingDocumentSummary[];
  created_at: string;
  updated_at: string;
}

export function ddCleared(item: DDChecklistItem): boolean {
  return item.status === 'complete' || item.status === 'waived';
}

export function cpCleared(item: ConditionPrecedent): boolean {
  return item.status === 'satisfied' || item.status === 'waived';
}
