import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { QuoteDocumentUploader } from './QuoteDocumentUploader';
import type { Quote } from '@/types/quote';

const hooks = vi.hoisted(() => ({
  documents: {
    data: [
      {
        id: 'doc-ready',
        document_name: 'Term sheet v1',
        category: 'legal',
        subcategory: 'term_sheet',
        storage_status: 'ready',
      },
    ] as Array<Record<string, unknown>>,
    isLoading: false,
  },
  upload: { mutateAsync: vi.fn(), isPending: false },
  setAttachments: { mutateAsync: vi.fn(), isPending: false },
}));

vi.mock('@/lib/api/deals', () => ({
  useDealDocuments: () => hooks.documents,
}));

vi.mock('@/lib/api/documents', () => ({
  useUploadDocument: () => hooks.upload,
}));

vi.mock('@/lib/api/quotes', () => ({
  useSetQuoteAttachments: () => hooks.setAttachments,
}));

const quote = {
  id: 'quote-1',
  version: 1,
  attachments: [] as string[],
} as Quote;

describe('QuoteDocumentUploader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hooks.setAttachments.mutateAsync.mockResolvedValue({});
  });

  it('attaches an eligible existing document', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <QuoteDocumentUploader
        dealId="deal-1"
        quote={quote}
        open
        onOpenChange={onOpenChange}
      />,
    );

    await user.click(screen.getByRole('tab', { name: /Attach existing/i }));
    await user.selectOptions(screen.getByLabelText(/Eligible document/i), 'doc-ready');
    await user.click(screen.getByRole('button', { name: /^Attach$/i }));

    expect(hooks.setAttachments.mutateAsync).toHaveBeenCalledWith({
      quoteId: 'quote-1',
      payload: { document_ids: ['doc-ready'] },
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
