import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@/config/api', () => ({ apiRequest: api.request }));

import { useUpdateDeal, useUpdateProperty, useUpdateSponsor } from './deals';

describe('promoted intake fact mutations', () => {
  let queryClient: QueryClient;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    api.request.mockReset();
    queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    vi.spyOn(queryClient, 'invalidateQueries');
  });

  it('PATCHes only sponsor facts and invalidates sponsor, deal, and list queries', async () => {
    api.request.mockResolvedValue({ id: 'sponsor-1' });
    const payload = {
      website: '',
      years_experience: 0,
      completed_projects: null,
      bankruptcy_history: false,
    };
    const { result } = renderHook(() => useUpdateSponsor('sponsor-1'), { wrapper });

    await act(async () => { await result.current.mutateAsync(payload); });

    expect(api.request).toHaveBeenCalledWith('api/sponsors/sponsor-1/', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sponsors'] });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['deal'] });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['deals'] });
  });

  it('PATCHes only property facts and invalidates property, deal, and list queries', async () => {
    api.request.mockResolvedValue({ id: 'property-1' });
    const payload = {
      subtype: '',
      units: 0,
      rentable_square_feet: null,
      year_built: null,
      year_renovated: null,
      county: '',
    };
    const { result } = renderHook(() => useUpdateProperty('property-1'), { wrapper });

    await act(async () => { await result.current.mutateAsync(payload); });

    expect(api.request).toHaveBeenCalledWith('api/properties/property-1/', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['properties'] });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['deal'] });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['deals'] });
  });

  it('invalidates deal summary metrics after a deal edit', async () => {
    const deal = { id: 'deal-1', name: 'Updated deal' };
    api.request.mockResolvedValue(deal);
    const { result } = renderHook(() => useUpdateDeal('deal-1'), { wrapper });

    await act(async () => { await result.current.mutateAsync({ name: 'Updated deal' }); });

    expect(queryClient.getQueryData(['deal', 'deal-1'])).toEqual(deal);
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['deals'] });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['deal-summary'] });
  });
});
