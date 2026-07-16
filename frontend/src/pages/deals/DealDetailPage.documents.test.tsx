import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DocumentsPanel } from './DealDetailPage';
import type { DealDocument } from '@/types/deal';

const documentHooks = vi.hoisted(() => ({
  download: { mutate: vi.fn(), isPending: false },
  update: { mutate: vi.fn(), isPending: false },
  remove: { mutate: vi.fn(), isPending: false },
}));

vi.mock('@/lib/api/documents', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/api/documents')>();
  return {
    ...original,
    useDownloadDocument: () => documentHooks.download,
    useUpdateDocumentMetadata: () => documentHooks.update,
    useDeleteDocument: () => documentHooks.remove,
  };
});

const protectedDocument = {
  id: 'document-1',
  document_name: 'Executed term sheet',
  category: 'legal',
  version: 1,
  file_type: 'pdf',
  file_size_bytes: 1024,
  expiry_date: null,
  is_executed: true,
  can_edit: false,
  edit_block_reason: 'Executed document metadata cannot be changed.',
  can_delete: false,
  delete_block_reason: 'Document is attached to an executed quote and cannot be deleted.',
} as DealDocument;

describe('DocumentsPanel action capabilities', () => {
  it('explains and disables actions the API says are unavailable', () => {
    render(
      <DocumentsPanel
        dealId="deal-1"
        documents={[protectedDocument]}
        isLoading={false}
        isError={false}
        onUpload={vi.fn()}
      />,
    );

    expect(
      screen.getByText('Document is attached to an executed quote and cannot be deleted.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: /Cannot delete Executed term sheet: Document is attached/i,
      }),
    ).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Edit Executed term sheet' })).not.toBeInTheDocument();
  });
});
