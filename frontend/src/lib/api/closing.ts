import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/config/api';
import { fetchAllPages } from '@/lib/api/deals';
import type {
  ClosingAssignee,
  ClosingGeneration,
  ClosingPackage,
  ConditionPrecedent,
  DDChecklistItem,
  DDTemplate,
} from '@/types/closing';

export type ClosingPackagePayload = Partial<Pick<
  ClosingPackage,
  | 'target_close_date'
  | 'actual_close_date'
  | 'funds_wired_date'
  | 'funds_wired_amount'
  | 'closing_attorney'
  | 'title_company'
  | 'purchase_price'
  | 'appraised_value'
  | 'final_loan_amount'
  | 'closing_costs'
  | 'sources_and_uses_notes'
  | 'notes'
>>;

export function useDDTemplates() {
  return useQuery({
    queryKey: ['dd-templates'],
    queryFn: () => fetchAllPages<DDTemplate>('api/dd-templates/'),
  });
}

export function useClosingPackage(dealId: string | undefined) {
  return useQuery({
    queryKey: ['closing-package', dealId],
    queryFn: async () => {
      const rows = await fetchAllPages<ClosingPackage>(
        `api/closing-packages/?deal=${encodeURIComponent(dealId!)}`,
      );
      return rows[0] ?? null;
    },
    enabled: Boolean(dealId),
  });
}

export function useClosingGenerations(dealId: string | undefined) {
  return useQuery({
    queryKey: ['closing-generations', dealId],
    queryFn: () =>
      fetchAllPages<ClosingGeneration>(
        `api/closing-generations/?deal=${encodeURIComponent(dealId!)}`,
      ),
    enabled: Boolean(dealId),
  });
}

export function useCurrentDDItems(dealId: string | undefined) {
  return useQuery({
    queryKey: ['dd-items', dealId, 'current'],
    queryFn: () =>
      fetchAllPages<DDChecklistItem>(
        `api/dd-checklist-items/?deal=${encodeURIComponent(dealId!)}&current=1`,
      ),
    enabled: Boolean(dealId),
  });
}

export function useDealDDItems(dealId: string | undefined) {
  return useQuery({
    queryKey: ['dd-items', dealId, 'all'],
    queryFn: () =>
      fetchAllPages<DDChecklistItem>(
        `api/dd-checklist-items/?deal=${encodeURIComponent(dealId!)}`,
      ),
    enabled: Boolean(dealId),
  });
}

export function useCurrentCPItems(dealId: string | undefined) {
  return useQuery({
    queryKey: ['cp-items', dealId, 'current'],
    queryFn: () =>
      fetchAllPages<ConditionPrecedent>(
        `api/conditions-precedent/?deal=${encodeURIComponent(dealId!)}&current=1`,
      ),
    enabled: Boolean(dealId),
  });
}

export function useDealCPItems(dealId: string | undefined) {
  return useQuery({
    queryKey: ['cp-items', dealId, 'all'],
    queryFn: () =>
      fetchAllPages<ConditionPrecedent>(
        `api/conditions-precedent/?deal=${encodeURIComponent(dealId!)}`,
      ),
    enabled: Boolean(dealId),
  });
}

function invalidateClosing(queryClient: ReturnType<typeof useQueryClient>, dealId: string) {
  void queryClient.invalidateQueries({ queryKey: ['closing-package', dealId] });
  void queryClient.invalidateQueries({ queryKey: ['closing-generations', dealId] });
  void queryClient.invalidateQueries({ queryKey: ['dd-items', dealId] });
  void queryClient.invalidateQueries({ queryKey: ['cp-items', dealId] });
  void queryClient.invalidateQueries({ queryKey: ['deal-documents', dealId] });
}

export function useUpsertClosingPackage(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ClosingPackagePayload) =>
      apiRequest<ClosingPackage>('api/closing-packages/', {
        method: 'POST',
        body: JSON.stringify({ deal: dealId, ...payload }),
      }),
    onSuccess: () => invalidateClosing(queryClient, dealId),
  });
}

export function usePatchClosingPackage(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      packageId,
      payload,
    }: {
      packageId: string;
      payload: ClosingPackagePayload;
    }) =>
      apiRequest<ClosingPackage>(`api/closing-packages/${packageId}/`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => invalidateClosing(queryClient, dealId),
  });
}

export function useGenerateClosingChecklist(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      template_id: string;
      force?: boolean;
      force_reason?: string;
      target_close_date?: string | null;
    }) =>
      apiRequest<ClosingGeneration>('api/closing-packages/generate/', {
        method: 'POST',
        body: JSON.stringify({ deal: dealId, ...payload }),
      }),
    onSuccess: () => invalidateClosing(queryClient, dealId),
  });
}

export function useClosingAssignees(packageId: string | undefined) {
  return useQuery({
    queryKey: ['closing-assignees', packageId],
    queryFn: () =>
      apiRequest<ClosingAssignee[]>(`api/closing-packages/${packageId}/assignees/`),
    enabled: Boolean(packageId),
  });
}

export type ClosingItemWritePayload = {
  title?: string;
  description?: string;
  owner?: number | null;
  due_date?: string | null;
  status?: string;
  waiver_reason?: string;
};

export type ClosingItemCreatePayload = {
  title: string;
  description?: string;
  owner?: number | null;
  due_date?: string | null;
};

export function useUpdateDDItem(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemId,
      payload,
    }: {
      itemId: string;
      payload: ClosingItemWritePayload;
    }) =>
      apiRequest<DDChecklistItem>(`api/dd-checklist-items/${itemId}/`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => invalidateClosing(queryClient, dealId),
  });
}

export function useUpdateCPItem(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemId,
      payload,
    }: {
      itemId: string;
      payload: ClosingItemWritePayload;
    }) =>
      apiRequest<ConditionPrecedent>(`api/conditions-precedent/${itemId}/`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => invalidateClosing(queryClient, dealId),
  });
}

export function useCreateDDItem(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ClosingItemCreatePayload) =>
      apiRequest<DDChecklistItem>('api/dd-checklist-items/', {
        method: 'POST',
        body: JSON.stringify({ deal: dealId, ...payload }),
      }),
    onSuccess: () => invalidateClosing(queryClient, dealId),
  });
}

export function useCreateCPItem(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ClosingItemCreatePayload) =>
      apiRequest<ConditionPrecedent>('api/conditions-precedent/', {
        method: 'POST',
        body: JSON.stringify({ deal: dealId, ...payload }),
      }),
    onSuccess: () => invalidateClosing(queryClient, dealId),
  });
}

export function useDeleteDDItem(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      apiRequest(`api/dd-checklist-items/${itemId}/`, { method: 'DELETE' }),
    onSuccess: () => invalidateClosing(queryClient, dealId),
  });
}

export function useDeleteCPItem(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (itemId: string) =>
      apiRequest(`api/conditions-precedent/${itemId}/`, { method: 'DELETE' }),
    onSuccess: () => invalidateClosing(queryClient, dealId),
  });
}

export function useSetDDDocuments(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, documentIds }: { itemId: string; documentIds: string[] }) =>
      apiRequest<DDChecklistItem>(`api/dd-checklist-items/${itemId}/documents/`, {
        method: 'POST',
        body: JSON.stringify({ document_ids: documentIds }),
      }),
    onSuccess: () => invalidateClosing(queryClient, dealId),
  });
}

export function useSetCPDocuments(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, documentIds }: { itemId: string; documentIds: string[] }) =>
      apiRequest<ConditionPrecedent>(`api/conditions-precedent/${itemId}/documents/`, {
        method: 'POST',
        body: JSON.stringify({ document_ids: documentIds }),
      }),
    onSuccess: () => invalidateClosing(queryClient, dealId),
  });
}
