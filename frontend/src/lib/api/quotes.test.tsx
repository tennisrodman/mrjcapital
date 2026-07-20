import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('@/config/api', () => ({ apiRequest: api.request }));

import { useExecuteQuote } from './quotes';
import type { Quote } from '@/types/quote';

describe('quote query cache', () => {
  it('refreshes document capabilities after quote execution', async () => {
    api.request.mockResolvedValue({
      id: 'quote-1',
      deal: 'deal-1',
      version: 1,
      status: 'executed',
      is_current: true,
      updated_at: '2026-07-16T12:00:00Z',
    } as Quote);
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: queryClient }, children);
    const execute = renderHook(() => useExecuteQuote('deal-1'), { wrapper });

    await act(async () => {
      await execute.result.current.mutateAsync('quote-1');
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['deal-documents', 'deal-1'] });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['deal-allowed-transitions', 'deal-1'],
    });
  });
});
