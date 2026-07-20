import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

import { apiRequest } from '@/config/api';
import { fetchAllPages } from '@/lib/api/pagination';
import type {
  ActivityLogEntry,
  Broker,
  Deal,
  DealDocument,
  DealFilters,
  DealSummary,
  DealStageEvent,
  Fund,
  PipelineStatus,
  Property,
  Sponsor,
  SyndicationStatus,
} from '@/types/deal';

type QueryParams = Record<string, string | undefined>;

function buildQuery(params: QueryParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, value);
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

function dealFilterParams(filters: DealFilters): QueryParams {
  return {
    search: filters.search,
    pipeline_status: filters.pipeline_status,
    syndication_status: filters.syndication_status,
    investment_type: filters.investment_type,
    source_channel: filters.source_channel,
    assigned_analyst: filters.assigned_analyst,
  };
}

// The board and table want every matching deal. The shared paginator batches API
// pages without imposing a hidden record ceiling.
async function fetchAllDeals(params: QueryParams): Promise<Deal[]> {
  return fetchAllPages<Deal>(`api/deals/${buildQuery(params)}`);
}

export function useDeals(filters: DealFilters) {
  const params = dealFilterParams(filters);
  return useQuery({
    queryKey: ['deals', params],
    queryFn: () => fetchAllDeals(params),
    placeholderData: keepPreviousData,
  });
}

export function useDealSummary(filters: DealFilters) {
  const params = dealFilterParams(filters);
  return useQuery({
    queryKey: ['deal-summary', params],
    queryFn: () => apiRequest<DealSummary>(`api/deals/summary/${buildQuery(params)}`),
    placeholderData: keepPreviousData,
  });
}

export function useDeal(id: string | undefined) {
  return useQuery({
    queryKey: ['deal', id],
    queryFn: () => apiRequest<Deal>(`api/deals/${id}/`),
    enabled: Boolean(id),
  });
}

export function useDealDocuments(dealId: string | undefined) {
  return useQuery({
    queryKey: ['deal-documents', dealId],
    queryFn: () => fetchAllPages<DealDocument>(`api/documents/?deal=${dealId}`),
    enabled: Boolean(dealId),
  });
}

export function useDealStageHistory(dealId: string | undefined) {
  return useQuery({
    queryKey: ['deal-stage-history', dealId],
    queryFn: () => fetchAllPages<DealStageEvent>(`api/deals/${dealId}/stage-history/`),
    enabled: Boolean(dealId),
  });
}

// Activity logs are an admin-only endpoint; gate the query on staff to avoid 403s.
export function useDealActivity(dealId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['deal-activity', dealId],
    queryFn: () => fetchAllPages<ActivityLogEntry>(`api/activity-logs/?deal=${dealId}`),
    enabled: Boolean(dealId) && enabled,
  });
}

// --- Reference data (for pickers in the create/edit forms) -----------------

export function useSponsors() {
  return useQuery({ queryKey: ['sponsors'], queryFn: () => fetchAllPages<Sponsor>('api/sponsors/') });
}

export function useBrokers() {
  return useQuery({ queryKey: ['brokers'], queryFn: () => fetchAllPages<Broker>('api/brokers/') });
}

export function useFunds() {
  return useQuery({ queryKey: ['funds'], queryFn: () => fetchAllPages<Fund>('api/funds/') });
}

export function useProperties() {
  return useQuery({
    queryKey: ['properties'],
    queryFn: () => fetchAllPages<Property>('api/properties/'),
  });
}

// --- Mutations -------------------------------------------------------------

// Inline-creatable inputs. A field is either an existing id (string) or a new
// object to create alongside the deal — the nested-write contract the Add-deal
// flow posts to through the Live API.
export interface SponsorInput {
  entity_name: string;
  entity_type: Sponsor['entity_type'];
  primary_contact_name: string;
  primary_contact_email: string;
  primary_contact_phone?: string;
  relationship_rating: Sponsor['relationship_rating'];
  website?: string;
  years_experience?: number;
  completed_projects?: number;
  bankruptcy_history?: boolean;
  business_address?: string;
  total_units_owned?: number;
  total_sf_managed?: number;
  assets_under_management?: string;
  connection_source?: Sponsor['connection_source'];
}

export interface BrokerInput {
  company_name: string;
  contact_name: string;
  email: string;
  phone?: string;
  default_commission_rate?: string;
  commission_type?: Broker['commission_type'];
  preferred_deal_types?: string[];
  geographic_focus?: string[];
}

export interface PropertyInput {
  address: string;
  city: string;
  state: string;
  zip: string;
  property_type: Property['property_type'];
  subtype?: string;
  units?: number;
  rentable_square_feet?: number;
  year_built?: number;
  year_renovated?: number;
  county?: string;
  msa?: string;
  number_of_buildings?: number;
  number_of_stories?: number;
  parking_spaces?: number;
  lot_size_acres?: string;
  flood_zone?: string;
  zoning_designation?: string;
  environmental_status?: Property['environmental_status'];
}

export interface CreateDealPayload {
  name: string;
  investment_type: Deal['investment_type'];
  requested_amount: string;
  purpose?: Deal['purpose'];
  profile?: Deal['profile'];
  estimated_value?: string;
  renovation_budget?: string;
  description?: string;
  source_channel: Deal['source_channel'];
  source_date: string;
  sponsor?: string | SponsorInput | null;
  broker?: string | BrokerInput | null;
  fund?: string | null;
  properties?: (string | PropertyInput)[];
}

export interface UpdateDealPayload {
  name?: string;
  investment_type?: Deal['investment_type'];
  requested_amount?: string;
  purpose?: Deal['purpose'];
  profile?: Deal['profile'];
  estimated_value?: string | null;
  renovation_budget?: string | null;
  description?: string;
  source_channel?: Deal['source_channel'];
  source_date?: string;
  sponsor?: string | null;
  broker?: string | null;
  fund?: string | null;
  assigned_analyst?: number | null;
  property_ids?: string[];
  deposit_status?: Deal['deposit_status'];
  deposit_received_date?: string | null;
  deposit_account_label?: string;
  deposit_refund_conditions?: string;
  exclusivity_granted?: boolean | null;
  exclusivity_expiry_date?: string | null;
  key_negotiation_changes?: string;
}

export interface UpdateSponsorFactsPayload {
  entity_name?: string;
  entity_type?: Sponsor['entity_type'];
  primary_contact_name?: string;
  primary_contact_email?: string;
  primary_contact_phone?: string;
  relationship_rating?: Sponsor['relationship_rating'];
  website?: string;
  years_experience?: number | null;
  completed_projects?: number | null;
  bankruptcy_history?: boolean | null;
  business_address?: string;
  total_units_owned?: number | null;
  total_sf_managed?: number | null;
  assets_under_management?: string | null;
  connection_source?: Sponsor['connection_source'];
}

export interface UpdatePropertyFactsPayload {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  property_type?: Property['property_type'];
  subtype?: string;
  units?: number | null;
  rentable_square_feet?: number | null;
  year_built?: number | null;
  year_renovated?: number | null;
  county?: string;
  msa?: string;
  number_of_buildings?: number | null;
  number_of_stories?: number | null;
  parking_spaces?: number | null;
  lot_size_acres?: string | null;
  flood_zone?: string;
  zoning_designation?: string;
  environmental_status?: Property['environmental_status'];
}

export type UpdateBrokerFactsPayload = Omit<Broker, 'id' | 'details'>;

export interface DealAssignee {
  id: number;
  username: string;
}

export function useCreateDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateDealPayload) =>
      apiRequest<Deal>('api/deals/', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['deals'] });
      void queryClient.invalidateQueries({ queryKey: ['deal-summary'] });
    },
  });
}

export function useUpdateDeal(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateDealPayload) =>
      apiRequest<Deal>(`api/deals/${id}/`, { method: 'PATCH', body: JSON.stringify(payload) }),
    onSuccess: (deal) => {
      queryClient.setQueryData(['deal', id], deal);
      void queryClient.invalidateQueries({ queryKey: ['deals'] });
      void queryClient.invalidateQueries({ queryKey: ['deal-summary'] });
    },
  });
}

export function useUpdateSponsor(sponsorId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateSponsorFactsPayload) =>
      apiRequest<Sponsor>(`api/sponsors/${sponsorId}/`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sponsors'] });
      void queryClient.invalidateQueries({ queryKey: ['deal'] });
      void queryClient.invalidateQueries({ queryKey: ['deals'] });
    },
  });
}

export function useUpdateProperty(propertyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdatePropertyFactsPayload) =>
      apiRequest<Property>(`api/properties/${propertyId}/`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['properties'] });
      void queryClient.invalidateQueries({ queryKey: ['deal'] });
      void queryClient.invalidateQueries({ queryKey: ['deals'] });
    },
  });
}

export function useCreateProperty() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: PropertyInput) =>
      apiRequest<Property>('api/properties/', { method: 'POST', body: JSON.stringify(payload) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['properties'] }),
  });
}

export function useUpdateBroker(brokerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateBrokerFactsPayload) =>
      apiRequest<Broker>(`api/brokers/${brokerId}/`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['brokers'] });
      void queryClient.invalidateQueries({ queryKey: ['deal'] });
      void queryClient.invalidateQueries({ queryKey: ['deals'] });
    },
  });
}

export function useDealAssignees(enabled: boolean) {
  return useQuery({
    queryKey: ['deal-assignees'],
    queryFn: () => apiRequest<DealAssignee[]>('api/deals/assignees/'),
    enabled,
  });
}

export interface AllowedTransitions {
  pipeline_status: PipelineStatus[];
  syndication_status: SyndicationStatus[];
  readiness: Partial<Record<PipelineStatus, TransitionReadiness>>;
}

export interface TransitionReadiness {
  ready: boolean;
  code: string;
  blockers: string[];
  can_override: boolean;
}

export function useAllowedTransitions(id: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['deal-allowed-transitions', id],
    queryFn: () => apiRequest<AllowedTransitions>(`api/deals/${id}/allowed-transitions/`),
    enabled: Boolean(id) && enabled,
  });
}

function useTransitionMutation(id: string, urlPath: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (vars: { to_status: string; reason: string; override_readiness?: boolean }) =>
      apiRequest<Deal>(`api/deals/${id}/${urlPath}/`, {
        method: 'POST',
        body: JSON.stringify(vars),
      }),
    onSuccess: (deal) => {
      queryClient.setQueryData(['deal', id], deal);
      void queryClient.invalidateQueries({ queryKey: ['deals'] });
      void queryClient.invalidateQueries({ queryKey: ['deal-summary'] });
      void queryClient.invalidateQueries({ queryKey: ['deal-allowed-transitions', id] });
      void queryClient.invalidateQueries({ queryKey: ['deal-activity', id] });
      void queryClient.invalidateQueries({ queryKey: ['deal-stage-history', id] });
    },
  });
}

export function useTransitionPipeline(id: string) {
  return useTransitionMutation(id, 'transition');
}

export function useTransitionSyndication(id: string) {
  return useTransitionMutation(id, 'transition-syndication');
}
