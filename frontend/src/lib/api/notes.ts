import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/config/api';
import type { DealNote, Paginated } from '@/types/deal';

// Notes are a staff-only endpoint; gate the query on staff to avoid 403s.
export function useDealNotes(dealId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['deal-notes', dealId],
    queryFn: async () => {
      const page = await apiRequest<Paginated<DealNote>>(`api/deal-notes/?deal=${dealId}`);
      return page.results;
    },
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
