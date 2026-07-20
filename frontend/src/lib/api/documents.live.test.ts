import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  request: vi.fn(),
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer live-access' })),
}));

vi.mock('@/config/api', () => ({
  API_URL: 'https://app.example.test',
  apiRequest: api.request,
  getAuthHeaders: api.getAuthHeaders,
}));

import type { DealDocument, DocumentUploadIntentResponse } from '@/types/deal';
import { uploadDocument } from './documents';

describe('uploadDocument Live target adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('crypto', {
      subtle: {
        digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer),
      },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
  });

  it('uploads to a same-origin target with auth and then completes the intent', async () => {
    const file = testFile();
    const completed = completedDocument('doc-local');
    api.request
      .mockResolvedValueOnce(uploadIntent('doc-local', '/api/documents/doc-local/blob/', {}))
      .mockResolvedValueOnce(completed);

    await expect(uploadDocument({
      dealId: 'deal-1',
      file,
      documentName: 'Term Sheet',
      category: 'legal',
      subcategory: 'term_sheet',
    })).resolves.toBe(completed);

    expect(api.request).toHaveBeenNthCalledWith(1, 'api/documents/upload-intent/', {
      method: 'POST',
      body: JSON.stringify({
        deal: 'deal-1',
        document_name: 'Term Sheet',
        category: 'legal',
        subcategory: 'term_sheet',
        file_type: 'txt',
        content_type: 'text/plain',
        file_size_bytes: 3,
        checksum_sha256: '0'.repeat(64),
        visibility_roles: ['internal'],
        notes: '',
      }),
    });
    expect(fetch).toHaveBeenCalledWith('https://app.example.test/api/documents/doc-local/blob/', {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer live-access',
        'Content-Type': 'text/plain',
      },
      body: file,
    });
    expect(api.request).toHaveBeenNthCalledWith(2, 'api/documents/doc-local/complete/', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  });

  it('preserves signed external headers without leaking the Live authorization token', async () => {
    const file = testFile();
    const completed = completedDocument('doc-r2');
    api.request
      .mockResolvedValueOnce(uploadIntent(
        'doc-r2',
        'https://uploads.example-r2.test/signed-target',
        { 'Content-Type': 'text/plain', 'x-amz-checksum-sha256': 'signed-checksum' },
      ))
      .mockResolvedValueOnce(completed);

    await uploadDocument({
      dealId: 'deal-1',
      file,
      documentName: 'Term Sheet',
      category: 'legal',
    });

    expect(fetch).toHaveBeenCalledWith('https://uploads.example-r2.test/signed-target', {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/plain',
        'x-amz-checksum-sha256': 'signed-checksum',
      },
      body: file,
    });
    expect(api.getAuthHeaders).not.toHaveBeenCalled();
  });
});

function testFile(): File {
  const file = new File(['abc'], 'term-sheet.txt', { type: 'text/plain' });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new TextEncoder().encode('abc').buffer,
  });
  return file;
}

function uploadIntent(
  id: string,
  uploadUrl: string,
  uploadHeaders: Record<string, string>,
): DocumentUploadIntentResponse {
  return {
    document: completedDocument(id),
    upload_url: uploadUrl,
    upload_method: 'PUT',
    upload_headers: uploadHeaders,
    expires_in: 900,
  };
}

function completedDocument(id: string): DealDocument {
  return {
    id,
    deal: 'deal-1',
    document_name: 'Term Sheet',
    category: 'legal',
    subcategory: 'term_sheet',
    version: 1,
    file_url: `deals/deal-1/${id}/v1/term-sheet.txt`,
    file_type: 'txt',
    content_type: 'text/plain',
    file_size_bytes: 3,
    checksum_sha256: '0'.repeat(64),
    storage_status: 'ready',
    pipeline_stage_at_upload: 'negotiating',
    uploaded_by: 1,
    uploaded_by_username: 'analyst',
    uploaded_date: '2026-07-16T12:00:00Z',
    is_executed: false,
    expiry_date: null,
    notes: '',
    visibility_roles: ['internal'],
    details: {},
    can_edit: true,
    edit_block_reason: '',
    can_delete: true,
    delete_block_reason: '',
  };
}
