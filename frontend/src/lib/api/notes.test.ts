import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from '@/config/api';
import type { DealNote, Paginated } from '@/types/deal';
import { fetchDealNotes } from './notes';

vi.mock('@/config/api', () => ({ apiRequest: vi.fn() }));

const request = vi.mocked(apiRequest);

describe('fetchDealNotes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('loads every API page instead of dropping notes after page one', async () => {
    const first = [{ id: 'note-1' }] as DealNote[];
    const second = [{ id: 'note-2' }] as DealNote[];
    request
      .mockResolvedValueOnce({ count: 51, results: first } as Paginated<DealNote>)
      .mockResolvedValueOnce({ count: 51, results: second } as Paginated<DealNote>);

    await expect(fetchDealNotes('deal-1')).resolves.toEqual([...first, ...second]);
    expect(request).toHaveBeenNthCalledWith(1, 'api/deal-notes/?deal=deal-1&page=1');
    expect(request).toHaveBeenNthCalledWith(2, 'api/deal-notes/?deal=deal-1&page=2');
  });
});
