import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/config/api';
import type {
  CreateScreeningAssessmentPayload,
  FinalizeScreeningAssessmentPayload,
  ScreeningAssessment,
  UpdateScreeningAssessmentPayload,
} from '@/types/screening';
import type { Paginated } from '@/types/deal';

type ScreeningAssessmentListResponse = Paginated<ScreeningAssessment> | ScreeningAssessment[];

const assessmentQueryKey = (dealId: string) => ['screening-assessments', dealId] as const;

function listResults(response: ScreeningAssessmentListResponse): ScreeningAssessment[] {
  return Array.isArray(response) ? response : response.results;
}

function sortMostRecent(assessments: ScreeningAssessment[]): ScreeningAssessment[] {
  return [...assessments].sort((a, b) => {
    if (a.version !== b.version) return b.version - a.version;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

function replaceCachedAssessment(
  existing: ScreeningAssessment[] | undefined,
  incoming: ScreeningAssessment,
): ScreeningAssessment[] {
  const withoutIncoming = (existing ?? []).filter((assessment) => assessment.id !== incoming.id);
  return sortMostRecent([incoming, ...withoutIncoming]);
}

export async function listScreeningAssessments(dealId: string): Promise<ScreeningAssessment[]> {
  const response = await apiRequest<ScreeningAssessmentListResponse>(
    `api/screening-assessments/?deal=${encodeURIComponent(dealId)}`,
  );
  return sortMostRecent(listResults(response));
}

export function createScreeningAssessment(
  payload: CreateScreeningAssessmentPayload,
): Promise<ScreeningAssessment> {
  return apiRequest<ScreeningAssessment>('api/screening-assessments/', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateScreeningAssessment(
  assessmentId: string,
  payload: UpdateScreeningAssessmentPayload,
): Promise<ScreeningAssessment> {
  return apiRequest<ScreeningAssessment>(`api/screening-assessments/${assessmentId}/`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function finalizeScreeningAssessment(
  assessmentId: string,
  payload: FinalizeScreeningAssessmentPayload,
): Promise<ScreeningAssessment> {
  return apiRequest<ScreeningAssessment>(`api/screening-assessments/${assessmentId}/finalize/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Latest version is the current assessment, regardless of draft/finalized status. */
export function currentScreeningAssessment(
  assessments: ScreeningAssessment[] | undefined,
): ScreeningAssessment | undefined {
  return assessments ? sortMostRecent(assessments)[0] : undefined;
}

export function useScreeningAssessments(dealId: string | undefined) {
  return useQuery({
    queryKey: assessmentQueryKey(dealId ?? ''),
    queryFn: () => listScreeningAssessments(dealId ?? ''),
    enabled: Boolean(dealId),
  });
}

export function useCreateScreeningAssessment(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createScreeningAssessment,
    onSuccess: (assessment) => {
      queryClient.setQueryData<ScreeningAssessment[]>(assessmentQueryKey(dealId), (existing) =>
        replaceCachedAssessment(existing, assessment),
      );
      void queryClient.invalidateQueries({ queryKey: ['deal-allowed-transitions', dealId] });
    },
  });
}

export function useUpdateScreeningAssessment(assessmentId: string, dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateScreeningAssessmentPayload) =>
      updateScreeningAssessment(assessmentId, payload),
    onSuccess: (assessment) => {
      queryClient.setQueryData<ScreeningAssessment[]>(assessmentQueryKey(dealId), (existing) =>
        replaceCachedAssessment(existing, assessment),
      );
      void queryClient.invalidateQueries({ queryKey: ['deal-allowed-transitions', dealId] });
    },
  });
}

export function useFinalizeScreeningAssessment(assessmentId: string, dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: FinalizeScreeningAssessmentPayload) =>
      finalizeScreeningAssessment(assessmentId, payload),
    onSuccess: (assessment) => {
      queryClient.setQueryData<ScreeningAssessment[]>(assessmentQueryKey(dealId), (existing) =>
        replaceCachedAssessment(existing, assessment),
      );
      void queryClient.invalidateQueries({ queryKey: ['deal-allowed-transitions', dealId] });
    },
  });
}
