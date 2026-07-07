import { describe, expect, it } from 'vitest';

import { mockApiRequest } from './handlers';
import type { Deal, DealDocument, DealNote, Paginated } from '@/types/deal';

async function firstDealId(): Promise<string> {
  const page = await mockApiRequest<Paginated<Deal>>('api/deals/?page=1');
  return page.results[0].id;
}

async function readyDocuments(): Promise<DealDocument[]> {
  const page = await mockApiRequest<Paginated<DealDocument>>('api/documents/?page=1');
  return page.results;
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

  it('creates a note with a same-deal document attachment', async () => {
    const doc = (await readyDocuments())[0];
    const created = await mockApiRequest<DealNote>('api/deal-notes/', {
      method: 'POST',
      body: JSON.stringify({ deal: doc.deal, body: 'see attached', attachments: [doc.id] }),
    });
    expect(created.attachments).toEqual([doc.id]);
  });

  it('rejects a document attachment from a different deal', async () => {
    const docs = await readyDocuments();
    const first = docs[0];
    const other = docs.find((d) => d.deal !== first.deal);
    expect(other).toBeDefined();
    await expect(
      mockApiRequest('api/deal-notes/', {
        method: 'POST',
        body: JSON.stringify({ deal: first.deal, body: 'x', attachments: [other!.id] }),
      }),
    ).rejects.toThrow();
  });
});
