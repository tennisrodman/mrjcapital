import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from '@/config/api';
import type { Paginated } from '@/types/deal';
import { fetchAllPages } from './pagination';

vi.mock('@/config/api', () => ({ apiRequest: vi.fn() }));

const request = vi.mocked(apiRequest);

describe('fetchAllPages', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not silently stop after the former 1,000-row cap', async () => {
    request.mockImplementation(async (path) => {
      const page = Number(new URL(`http://test/${path}`).searchParams.get('page'));
      return {
        count: 1001,
        next: page < 21 ? `page=${page + 1}` : null,
        previous: page > 1 ? `page=${page - 1}` : null,
        results: [page],
      } as Paginated<number>;
    });

    const results = await fetchAllPages<number>('api/deals/?pipeline_status=closing');

    expect(results).toEqual(Array.from({ length: 21 }, (_, index) => index + 1));
    expect(request).toHaveBeenCalledTimes(21);
    expect(request).toHaveBeenLastCalledWith(
      'api/deals/?pipeline_status=closing&page=21',
    );
  });
});
