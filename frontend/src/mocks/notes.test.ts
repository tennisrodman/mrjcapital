import { describe, expect, it } from 'vitest';

import { mockApiRequest } from './handlers';
import type { Deal, DealNote, Paginated } from '@/types/deal';

async function firstDealId(): Promise<string> {
  const page = await mockApiRequest<Paginated<Deal>>('api/deals/?page=1');
  return page.results[0].id;
}

describe('deal notes mock API', () => {
  it('creates, lists, and deletes a note', async () => {
    const dealId = await firstDealId();
    const created = await mockApiRequest<DealNote>('api/deal-notes/', {
      method: 'POST',
      body: JSON.stringify({ deal: dealId, body: 'Follow up with sponsor' }),
    });
    expect(created.body).toBe('Follow up with sponsor');
    expect(created.visibility_roles).toEqual(['internal']);

    const listed = await mockApiRequest<Paginated<DealNote>>(`api/deal-notes/?deal=${dealId}`);
    expect(listed.results.some((n) => n.id === created.id)).toBe(true);

    await mockApiRequest(`api/deal-notes/${created.id}/`, { method: 'DELETE' });
    const after = await mockApiRequest<Paginated<DealNote>>(`api/deal-notes/?deal=${dealId}`);
    expect(after.results.some((n) => n.id === created.id)).toBe(false);
  });

  it('rejects an empty note body', async () => {
    const dealId = await firstDealId();
    await expect(
      mockApiRequest('api/deal-notes/', {
        method: 'POST',
        body: JSON.stringify({ deal: dealId, body: '   ' }),
      }),
    ).rejects.toThrow();
  });
});
