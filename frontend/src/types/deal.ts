// Mirrors api/models/choices.py and api/serializers.py. Keep in sync when the
// backend choice sets or serializer field shapes change.

export type InvestmentType =
  | 'whole_loan_bridge'
  | 'whole_loan_permanent'
  | 'mezzanine'
  | 'preferred_equity'
  | 'co_gp_equity'
  | 'lp_equity';

export type InvestmentCategory = 'debt' | 'hybrid' | 'equity';
export type DealPurpose = 'acquisition' | 'refinance' | 'construction' | 'recapitalization';
export type DealProfile = 'value_add' | 'construction' | 'stabilized';
export type DepositStatus = '' | 'pending' | 'received' | 'applied_to_closing' | 'refunded';

export type PipelineStatus =
  | 'sourced'
  | 'screening'
  | 'quoting'
  | 'negotiating'
  | 'signed'
  | 'closing'
  | 'closed'
  | 'servicing'
  | 'on_hold'
  | 'dead'
  | 'exited';

export type SyndicationStatus =
  | 'not_started'
  | 'raising'
  | 'fully_subscribed'
  | 'closed'
  | 'cancelled';

export type SourceChannel =
  | 'broker'
  | 'direct'
  | 'referral'
  | 'repeat_sponsor'
  | 'internal_prospecting';

export type PropertyType =
  | 'multifamily'
  | 'office'
  | 'retail'
  | 'industrial'
  | 'hotel'
  | 'self_storage'
  | 'land'
  | 'mixed_use'
  | 'data_center'
  | 'condo'
  | 'master_planned_residential'
  | 'other';

export type PropertyEnvironmentalStatus =
  | ''
  | 'none'
  | 'phase_1_clean'
  | 'phase_1_rec'
  | 'phase_2_required'
  | 'phase_2_clean'
  | 'remediation';

export type SponsorEntityType = 'llc' | 'lp' | 'corp' | 'trust' | 'individual';

export type RelationshipRating = 'new' | 'developing' | 'established' | 'strategic';
export type SponsorConnectionSource =
  | ''
  | 'broker_referral'
  | 'direct'
  | 'repeat'
  | 'marketing'
  | 'conference';

export type BrokerStatus = 'active' | 'inactive' | 'blocked';
export type BrokerCommissionType =
  | ''
  | 'percent_of_loan'
  | 'flat_fee'
  | 'percent_of_equity'
  | 'referral_fee';

export type FundStatus = 'forming' | 'open' | 'closed';

export type DocumentCategory =
  | 'offering_memo'
  | 'financials'
  | 'rent_roll'
  | 'appraisal'
  | 'environmental'
  | 'title'
  | 'insurance'
  | 'legal'
  | 'entity_docs'
  | 'construction'
  | 'investor_docs'
  | 'correspondence'
  | 'closing_docs'
  | 'servicing'
  | 'other';

export type ActivityActionType =
  | 'status_change'
  | 'field_updated'
  | 'document_upload_started'
  | 'document_upload'
  | 'document_upload_abandoned'
  | 'document_delete_pending'
  | 'document_deleted'
  | 'note_added'
  | 'note_updated'
  | 'note_deleted'
  | 'sensitive_field_read'
  | 'closing_generated'
  | 'closing_regenerated'
  | 'closing_superseded'
  | 'closing_item_updated'
  | 'closing_document_linked'
  | 'closing_document_detached'
  | 'closing_package_updated'
  | 'quote_created'
  | 'quote_updated'
  | 'quote_sent'
  | 'quote_countered'
  | 'quote_executed'
  | 'quote_expired'
  | 'quote_withdrawn'
  | 'quote_attachments_updated'
  | 'screening_created'
  | 'screening_updated'
  | 'screening_finalized'
  | 'deal_contact_added'
  | 'deal_contact_updated'
  | 'deal_contact_deleted';

export interface Sponsor {
  id: string;
  entity_name: string;
  entity_type: SponsorEntityType;
  primary_contact_name: string;
  primary_contact_email: string;
  primary_contact_phone: string;
  relationship_rating: RelationshipRating;
  website: string;
  years_experience: number | null;
  completed_projects: number | null;
  bankruptcy_history: boolean | null;
  business_address: string;
  total_units_owned: number | null;
  total_sf_managed: number | null;
  assets_under_management: string | null;
  track_record: unknown[];
  connection_source: SponsorConnectionSource;
  details: Record<string, unknown>;
}

export interface Broker {
  id: string;
  company_name: string;
  contact_name: string;
  email: string;
  phone: string;
  status: BrokerStatus;
  default_commission_rate: string | null;
  commission_type: BrokerCommissionType;
  preferred_deal_types: string[];
  geographic_focus: string[];
  details: Record<string, unknown>;
}

export interface Fund {
  id: string;
  name: string;
  status: FundStatus;
  details: Record<string, unknown>;
}

export interface Property {
  id: string;
  address_normalized: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  property_type: PropertyType;
  subtype: string;
  units: number | null;
  rentable_square_feet: number | null;
  year_built: number | null;
  year_renovated: number | null;
  county: string;
  msa: string;
  number_of_buildings: number | null;
  number_of_stories: number | null;
  parking_spaces: number | null;
  lot_size_acres: string | null;
  flood_zone: string;
  zoning_designation: string;
  environmental_status: PropertyEnvironmentalStatus;
  details: Record<string, unknown>;
}

export interface DealPropertySummary {
  id: number;
  property: Property;
  is_primary: boolean;
}

export interface AnalystSummary {
  id: number;
  username: string;
}

export interface Deal {
  id: string;
  name: string;
  investment_type: InvestmentType;
  investment_category: InvestmentCategory;
  pipeline_status: PipelineStatus;
  syndication_status: SyndicationStatus;
  paused_from_status: PipelineStatus | null;
  sponsor: string | null;
  sponsor_detail: Sponsor | null;
  broker: string | null;
  broker_detail: Broker | null;
  assigned_analyst: number | null;
  assigned_analyst_detail: AnalystSummary | null;
  fund: string | null;
  fund_detail: Fund | null;
  source_channel: SourceChannel;
  source_date: string;
  requested_amount: string;
  purpose: DealPurpose | '';
  profile: DealProfile | '';
  estimated_value: string | null;
  renovation_budget: string | null;
  description: string;
  deposit_status: DepositStatus;
  deposit_received_date: string | null;
  deposit_account_label: string;
  deposit_refund_conditions: string;
  exclusivity_granted: boolean | null;
  exclusivity_expiry_date: string | null;
  key_negotiation_changes: string;
  current_stage_entered_at: string;
  days_in_current_stage: number;
  details: Record<string, unknown>;
  properties: DealPropertySummary[];
  created_at: string;
  updated_at: string;
}

export type DocumentStorageStatus = 'pending' | 'ready' | 'failed';

export interface DealDocument {
  id: string;
  deal: string;
  document_name: string;
  category: DocumentCategory;
  subcategory?: string;
  version: number;
  file_url: string;
  file_type: string;
  content_type?: string;
  file_size_bytes: number | null;
  checksum_sha256?: string;
  storage_status: DocumentStorageStatus;
  pipeline_stage_at_upload: PipelineStatus | null;
  uploaded_by: number | null;
  uploaded_by_username?: string | null;
  uploaded_date: string;
  is_executed: boolean;
  expiry_date: string | null;
  notes: string;
  visibility_roles: string[];
  details: Record<string, unknown>;
  can_edit: boolean;
  edit_block_reason: string;
  can_delete: boolean;
  delete_block_reason: string;
}

export interface DocumentUploadIntentResponse {
  document: DealDocument;
  upload_url: string;
  upload_method: string;
  upload_headers: Record<string, string>;
  expires_in: number;
}

export interface DocumentDownloadResponse {
  download_url: string;
  expires_in: number;
  document_name: string;
  filename: string;
  content_type: string;
  file_size_bytes: number | null;
}

export interface ActivityLogEntry {
  id: string;
  deal: string | null;
  action_type: ActivityActionType;
  performed_by: number | null;
  performed_at: string;
  ip_address: string | null;
  description: string;
  old_value: string;
  new_value: string;
  reason: string;
  metadata: Record<string, unknown>;
}

export interface DealStageEvent {
  id: string;
  deal: string;
  from_status: PipelineStatus | null;
  to_status: PipelineStatus;
  entered_at: string;
  exited_at: string | null;
  performed_by: number | null;
  performed_by_detail: AnalystSummary | null;
  reason: string;
  is_override: boolean;
}

export interface DealNote {
  id: string;
  deal: string;
  body: string;
  author: number | null;
  author_username: string | null;
  can_edit: boolean;
  can_delete: boolean;
  attachments: string[];
  visibility_roles: string[];
  created_at: string;
  updated_at: string;
}

export interface DealSummary {
  active_deals: number;
  pipeline_value: string | number;
  gross_pipeline_value: string | number;
  average_days_in_current_stage: number;
  by_pipeline_status: {
    pipeline_status: PipelineStatus;
    count: number;
    requested_amount: string | number;
    average_days_in_current_stage: number;
  }[];
  average_stage_duration_days: {
    pipeline_status: PipelineStatus;
    average_days: number;
    completed_events: number;
  }[];
}

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface DealFilters {
  search?: string;
  pipeline_status?: PipelineStatus;
  syndication_status?: SyndicationStatus;
  investment_type?: InvestmentType;
  source_channel?: SourceChannel;
  assigned_analyst?: string;
}
