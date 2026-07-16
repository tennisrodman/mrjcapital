import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/config/api';
import { fetchAllPages } from '@/lib/api/pagination';
import type {
  CreateQuotePayload,
  Quote,
  QuoteAttachmentsPayload,
  SendQuotePayload,
  UpdateQuotePayload,
} from '@/types/quote';

const quoteQueryKey = (dealId: string) => ['quotes', dealId] as const;

function sortMostRecent(quotes: Quote[]): Quote[] {
  return [...quotes].sort((a, b) => {
    if (a.version !== b.version) return b.version - a.version;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

function replaceCachedQuote(existing: Quote[] | undefined, incoming: Quote): Quote[] {
  const withoutIncoming = (existing ?? []).filter((quote) => quote.id !== incoming.id);
  // Counter creates a new current draft and demotes the prior version's is_current.
  const withFlags = withoutIncoming.map((quote) =>
    quote.deal === incoming.deal && incoming.is_current
      ? { ...quote, is_current: false }
      : quote,
  );
  return sortMostRecent([incoming, ...withFlags]);
}

export async function listQuotes(dealId: string): Promise<Quote[]> {
  const results = await fetchAllPages<Quote>(`api/quotes/?deal=${encodeURIComponent(dealId)}`);
  return sortMostRecent(results);
}

export function createQuote(payload: CreateQuotePayload): Promise<Quote> {
  return apiRequest<Quote>('api/quotes/', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateQuote(quoteId: string, payload: UpdateQuotePayload): Promise<Quote> {
  return apiRequest<Quote>(`api/quotes/${quoteId}/`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function sendQuote(quoteId: string, payload: SendQuotePayload = {}): Promise<Quote> {
  return apiRequest<Quote>(`api/quotes/${quoteId}/send/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function counterQuote(quoteId: string): Promise<Quote> {
  return apiRequest<Quote>(`api/quotes/${quoteId}/counter/`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function executeQuote(quoteId: string): Promise<Quote> {
  return apiRequest<Quote>(`api/quotes/${quoteId}/execute/`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function withdrawQuote(quoteId: string): Promise<Quote> {
  return apiRequest<Quote>(`api/quotes/${quoteId}/withdraw/`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function expireQuote(quoteId: string): Promise<Quote> {
  return apiRequest<Quote>(`api/quotes/${quoteId}/expire/`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function setQuoteAttachments(
  quoteId: string,
  payload: QuoteAttachmentsPayload,
): Promise<Quote> {
  return apiRequest<Quote>(`api/quotes/${quoteId}/attachments/`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** Latest version / is_current quote for the deal. */
export function currentQuote(quotes: Quote[] | undefined): Quote | undefined {
  if (!quotes?.length) return undefined;
  const flagged = quotes.find((quote) => quote.is_current);
  return flagged ?? sortMostRecent(quotes)[0];
}

export function useQuotes(dealId: string | undefined) {
  return useQuery({
    queryKey: quoteQueryKey(dealId ?? ''),
    queryFn: () => listQuotes(dealId ?? ''),
    enabled: Boolean(dealId),
  });
}

function useQuoteMutation<TVariables>(
  dealId: string,
  mutationFn: (variables: TVariables) => Promise<Quote>,
  options: { invalidateDocuments?: boolean } = {},
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (quote) => {
      queryClient.setQueryData<Quote[]>(quoteQueryKey(dealId), (existing) =>
        replaceCachedQuote(existing, quote),
      );
      if (options.invalidateDocuments) {
        void queryClient.invalidateQueries({ queryKey: ['deal-documents', dealId] });
      }
      void queryClient.invalidateQueries({ queryKey: ['deal-allowed-transitions', dealId] });
    },
  });
}

export function useCreateQuote(dealId: string) {
  return useQuoteMutation(dealId, createQuote);
}

export function useUpdateQuote(quoteId: string, dealId: string) {
  return useQuoteMutation(dealId, (payload: UpdateQuotePayload) => updateQuote(quoteId, payload));
}

function useQuoteAction(
  dealId: string,
  mutationFn: (quoteId: string) => Promise<Quote>,
) {
  return useQuoteMutation(dealId, mutationFn);
}

export function useSendQuote(dealId: string) {
  return useQuoteMutation(
    dealId,
    ({ quoteId, payload }: { quoteId: string; payload?: SendQuotePayload }) =>
      sendQuote(quoteId, payload),
  );
}

export function useCounterQuote(dealId: string) {
  return useQuoteAction(dealId, counterQuote);
}

export function useExecuteQuote(dealId: string) {
  return useQuoteAction(dealId, executeQuote);
}

export function useWithdrawQuote(dealId: string) {
  return useQuoteAction(dealId, withdrawQuote);
}

export function useExpireQuote(dealId: string) {
  return useQuoteAction(dealId, expireQuote);
}

export function useSetQuoteAttachments(dealId: string) {
  return useQuoteMutation(
    dealId,
    ({
      quoteId,
      payload,
    }: {
      quoteId: string;
      payload: QuoteAttachmentsPayload;
    }) => setQuoteAttachments(quoteId, payload),
    { invalidateDocuments: true },
  );
}
