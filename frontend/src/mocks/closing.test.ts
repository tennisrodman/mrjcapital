import { beforeEach, describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/apiError';
import {
  DEMO_DD_TEMPLATES,
  documentIsClosingLinked,
  handleClosingRequest,
  resetClosingMocks,
} from './closing';

function call(args: Parameters<typeof handleClosingRequest>[0]) {
  return handleClosingRequest(args);
}

describe('closing mock API', () => {
  beforeEach(() => {
    resetClosingMocks();
  });

  it('loads the seeded Vista closing example', () => {
    const packages = call({
      method: 'GET',
      resource: 'closing-packages',
      query: new URLSearchParams('deal=deal-vista'),
      body: null,
      dealStatus: 'closing',
    }) as { results: Array<{ id: string }> };
    expect(packages.results[0]?.id).toBe('cpkg-vista');

    const generations = call({
      method: 'GET',
      resource: 'closing-generations',
      query: new URLSearchParams('deal=deal-vista'),
      body: null,
      dealStatus: 'closing',
    }) as { count: number };
    expect(generations.count).toBe(1);
  });

  it('exposes fuller template catalogs matching Live seeds', () => {
    const debt = DEMO_DD_TEMPLATES.find((row) => row.key === 'debt_acquisition');
    expect(debt?.items.filter((item) => item.kind === 'dd')).toHaveLength(7);
    expect(debt?.items.filter((item) => item.kind === 'cp')).toHaveLength(2);
  });

  it('generates a checklist and preserves prior generation on regenerate', () => {
    const template = DEMO_DD_TEMPLATES[0];
    const first = call({
      method: 'POST',
      resource: 'closing-packages',
      id: 'generate',
      query: new URLSearchParams(),
      body: { deal: 'deal-1', template_id: template.id, target_close_date: '2026-09-01' },
      dealStatus: 'closing',
      isStaff: true,
    }) as { version: number; id: string };
    expect(first.version).toBe(1);

    const items = call({
      method: 'GET',
      resource: 'dd-checklist-items',
      query: new URLSearchParams('deal=deal-1&current=1'),
      body: null,
      dealStatus: 'closing',
    }) as { results: Array<{ due_date: string | null; title: string }> };
    const titleItem = items.results.find((row) => row.title === 'Title commitment / proforma policy');
    expect(titleItem?.due_date).toBe('2026-08-18');

    const second = call({
      method: 'POST',
      resource: 'closing-packages',
      id: 'generate',
      query: new URLSearchParams(),
      body: { deal: 'deal-1', template_id: template.id },
      dealStatus: 'closing',
      isStaff: true,
    }) as { version: number };
    expect(second.version).toBe(2);

    const history = call({
      method: 'GET',
      resource: 'closing-generations',
      query: new URLSearchParams('deal=deal-1'),
      body: null,
      dealStatus: 'closing',
    }) as { count: number };
    expect(history.count).toBe(2);
  });

  it('blocks mutations outside closing and when deal status is unknown', () => {
    expect(() =>
      call({
        method: 'POST',
        resource: 'closing-packages',
        id: 'generate',
        query: new URLSearchParams(),
        body: { deal: 'deal-1', template_id: DEMO_DD_TEMPLATES[0].id },
        dealStatus: 'signed',
      }),
    ).toThrow(ApiError);

    expect(() =>
      call({
        method: 'PATCH',
        resource: 'closing-packages',
        id: 'cpkg-vista',
        query: new URLSearchParams(),
        body: { notes: 'nope' },
      }),
    ).toThrow(ApiError);
  });

  it('requires staff for force supersede and blocks prior-generation deletes', () => {
    const template = DEMO_DD_TEMPLATES[0];
    call({
      method: 'POST',
      resource: 'closing-packages',
      id: 'generate',
      query: new URLSearchParams(),
      body: { deal: 'deal-1', template_id: template.id },
      dealStatus: 'closing',
      isStaff: true,
    });
    const items = call({
      method: 'GET',
      resource: 'dd-checklist-items',
      query: new URLSearchParams('deal=deal-1&current=1'),
      body: null,
      dealStatus: 'closing',
    }) as { results: Array<{ id: string }> };
    const itemId = items.results[0].id;
    call({
      method: 'PATCH',
      resource: 'dd-checklist-items',
      id: itemId,
      query: new URLSearchParams(),
      body: { status: 'complete' },
      dealStatus: 'closing',
      isStaff: true,
    });

    expect(() =>
      call({
        method: 'POST',
        resource: 'closing-packages',
        id: 'generate',
        query: new URLSearchParams(),
        body: {
          deal: 'deal-1',
          template_id: template.id,
          force: true,
          force_reason: 'Template refresh',
        },
        dealStatus: 'closing',
        isStaff: false,
      }),
    ).toThrow(ApiError);

    const forced = call({
      method: 'POST',
      resource: 'closing-packages',
      id: 'generate',
      query: new URLSearchParams(),
      body: {
        deal: 'deal-1',
        template_id: template.id,
        force: true,
        force_reason: 'Template refresh',
      },
      dealStatus: 'closing',
      isStaff: true,
    }) as { version: number };
    expect(forced.version).toBe(2);

    expect(() =>
      call({
        method: 'DELETE',
        resource: 'dd-checklist-items',
        id: itemId,
        query: new URLSearchParams(),
        body: null,
        dealStatus: 'closing',
        isStaff: true,
      }),
    ).toThrow(ApiError);
  });

  it('patches title/description/owner/due_date and uses max sort_order + 1', () => {
    const template = DEMO_DD_TEMPLATES[0];
    call({
      method: 'POST',
      resource: 'closing-packages',
      id: 'generate',
      query: new URLSearchParams(),
      body: { deal: 'deal-1', template_id: template.id },
      dealStatus: 'closing',
      isStaff: true,
    });
    const current = call({
      method: 'GET',
      resource: 'dd-checklist-items',
      query: new URLSearchParams('deal=deal-1&current=1'),
      body: null,
      dealStatus: 'closing',
    }) as { results: Array<{ id: string; sort_order: number }> };
    const maxSort = Math.max(...current.results.map((row) => row.sort_order));
    const created = call({
      method: 'POST',
      resource: 'dd-checklist-items',
      query: new URLSearchParams(),
      body: {
        deal: 'deal-1',
        title: 'Custom DD',
        description: 'Extra diligence',
        owner: 1,
        due_date: '2026-08-01',
      },
      dealStatus: 'closing',
      isStaff: true,
    }) as { id: string; sort_order: number; owner: number | null; description: string };
    expect(created.sort_order).toBe(maxSort + 1);
    expect(created.owner).toBe(1);

    const patched = call({
      method: 'PATCH',
      resource: 'dd-checklist-items',
      id: created.id,
      query: new URLSearchParams(),
      body: {
        title: 'Custom DD updated',
        description: 'Revised',
        owner: null,
        due_date: '2026-08-10',
      },
      dealStatus: 'closing',
      isStaff: true,
    }) as { title: string; description: string; owner: number | null; due_date: string | null };
    expect(patched.title).toBe('Custom DD updated');
    expect(patched.description).toBe('Revised');
    expect(patched.owner).toBeNull();
    expect(patched.due_date).toBe('2026-08-10');
  });

  it('preserves invisible documents when setting evidence', () => {
    const template = DEMO_DD_TEMPLATES[0];
    call({
      method: 'POST',
      resource: 'closing-packages',
      id: 'generate',
      query: new URLSearchParams(),
      body: { deal: 'deal-1', template_id: template.id },
      dealStatus: 'closing',
      isStaff: true,
    });
    const items = call({
      method: 'GET',
      resource: 'dd-checklist-items',
      query: new URLSearchParams('deal=deal-1&current=1'),
      body: null,
      dealStatus: 'closing',
    }) as { results: Array<{ id: string }> };
    const itemId = items.results[0].id;

    const docsById = {
      'doc-secret': {
        id: 'doc-secret',
        document_name: 'Secret.pdf',
        category: 'legal',
        storage_status: 'ready',
        file_type: 'pdf',
        file_size_bytes: 10,
        visibility_roles: ['closing'],
      },
      'doc-visible': {
        id: 'doc-visible',
        document_name: 'Visible.pdf',
        category: 'legal',
        storage_status: 'ready',
        file_type: 'pdf',
        file_size_bytes: 10,
        visibility_roles: ['internal'],
      },
    };

    call({
      method: 'POST',
      resource: 'dd-checklist-items',
      id: itemId,
      action: 'documents',
      query: new URLSearchParams(),
      body: { document_ids: ['doc-secret', 'doc-visible'] },
      dealStatus: 'closing',
      isStaff: true,
      resolveDocuments: (ids) => ids.map((id) => docsById[id as keyof typeof docsById]),
    });

    const after = call({
      method: 'POST',
      resource: 'dd-checklist-items',
      id: itemId,
      action: 'documents',
      query: new URLSearchParams(),
      body: { document_ids: ['doc-visible'] },
      dealStatus: 'closing',
      isStaff: false,
      resolveDocuments: (ids) =>
        ids
          .map((id) => docsById[id as keyof typeof docsById])
          .filter((doc) => (doc.visibility_roles ?? []).includes('internal')),
    }) as { documents: Array<{ id: string }> };

    expect(after.documents.map((doc) => doc.id)).toEqual(['doc-visible']);
    expect(documentIsClosingLinked('doc-secret')).toBe(true);

    const listed = call({
      method: 'GET',
      resource: 'dd-checklist-items',
      query: new URLSearchParams('deal=deal-1&current=1'),
      body: null,
      dealStatus: 'closing',
      isStaff: false,
    }) as { results: Array<{ id: string; documents: Array<{ id: string }> }> };
    const listedItem = listed.results.find((row) => row.id === itemId);
    expect(listedItem?.documents.map((doc) => doc.id)).toEqual(['doc-visible']);
  });

  it('returns assignees and patches package notes', () => {
    const packages = call({
      method: 'GET',
      resource: 'closing-packages',
      query: new URLSearchParams('deal=deal-vista'),
      body: null,
      dealStatus: 'closing',
    }) as { results: Array<{ id: string }> };
    const assignees = call({
      method: 'GET',
      resource: 'closing-packages',
      id: packages.results[0].id,
      action: 'assignees',
      query: new URLSearchParams(),
      body: null,
      dealStatus: 'closing',
    }) as Array<{ id: number; username: string }>;
    expect(assignees[0]?.username).toBe('demo');

    const patched = call({
      method: 'PATCH',
      resource: 'closing-packages',
      id: packages.results[0].id,
      query: new URLSearchParams(),
      body: { notes: 'Escrow with First American' },
      dealStatus: 'closing',
      isStaff: true,
    }) as { notes: string };
    expect(patched.notes).toBe('Escrow with First American');
  });
});
