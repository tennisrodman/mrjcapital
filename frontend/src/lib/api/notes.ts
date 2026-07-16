import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/config/api';
import { fetchAllPages } from '@/lib/api/pagination';
import type { DealNote } from '@/types/deal';

export function fetchDealNotes(dealId: string): Promise<DealNote[]> {
  return fetchAllPages<DealNote>(`api/deal-notes/?deal=${dealId}`);
}

// Notes are a staff-only endpoint; gate the query on staff to avoid 403s.
export function useDealNotes(dealId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['deal-notes', dealId],
    queryFn: () => fetchDealNotes(dealId!),
    enabled: Boolean(dealId) && enabled,
  });
}

export interface CreateNotePayload {
  deal: string;
  body: string;
  attachments?: string[];
}

export function useCreateNote(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateNotePayload) =>
      apiRequest<DealNote>('api/deal-notes/', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['deal-notes', dealId] });
      void queryClient.invalidateQueries({ queryKey: ['deal-activity', dealId] });
    },
  });
}

export function useDeleteNote(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (noteId: string) =>
      apiRequest<Record<string, never>>(`api/deal-notes/${noteId}/`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['deal-notes', dealId] });
    },
  });
}

export function useUpdateNote(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ noteId, body }: { noteId: string; body: string }) =>
      apiRequest<DealNote>(`api/deal-notes/${noteId}/`, {
        method: 'PATCH',
        body: JSON.stringify({ body }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['deal-notes', dealId] });
      void queryClient.invalidateQueries({ queryKey: ['deal-activity', dealId] });
    },
  });
}
