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
  | 'closed';

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

export type SponsorEntityType = 'llc' | 'lp' | 'corp' | 'trust' | 'individual';

export type RelationshipRating = 'new' | 'developing' | 'established' | 'strategic';

export type BrokerStatus = 'active' | 'inactive' | 'blocked';

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
  | 'document_upload'
  | 'note_added'
  | 'sensitive_field_read';

export interface Sponsor {
  id: string;
  entity_name: string;
  entity_type: SponsorEntityType;
  primary_contact_name: string;
  primary_contact_email: string;
  primary_contact_phone: string;
  relationship_rating: RelationshipRating;
  details: Record<string, unknown>;
}

export interface Broker {
  id: string;
  company_name: string;
  contact_name: string;
  email: string;
  phone: string;
  status: BrokerStatus;
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
  msa: string;
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
  sponsor: string;
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
  details: Record<string, unknown>;
  properties: DealPropertySummary[];
  created_at: string;
  updated_at: string;
}

export interface DealDocument {
  id: string;
  deal: string;
  document_name: string;
  category: DocumentCategory;
  version: number;
  file_url: string;
  file_type: string;
  uploaded_by: number | null;
  uploaded_date: string;
  is_executed: boolean;
  expiry_date: string | null;
  notes: string;
  visibility_roles: string[];
  details: Record<string, unknown>;
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

export interface DealSummary {
  active_deals: number;
  pipeline_value: string | number;
  gross_pipeline_value: string | number;
  by_pipeline_status: { pipeline_status: PipelineStatus; count: number }[];
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
