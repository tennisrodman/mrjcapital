import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { NoteAttachments } from './NoteAttachments';
import type { DealDocument } from '@/types/deal';

const document = {
  id: 'doc-1',
  document_name: 'Signed term sheet',
  version: 3,
} as DealDocument;

describe('NoteAttachments', () => {
  it('renders named attachments and downloads the selected document', async () => {
    const onDownload = vi.fn();
    const user = userEvent.setup();

    render(
      <NoteAttachments
        attachmentIds={[document.id]}
        documents={[document]}
        onDownload={onDownload}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Download Signed term sheet, version 3' }),
    );
    expect(onDownload).toHaveBeenCalledWith(document);
  });

  it('keeps a visible placeholder when an attached document is unavailable', () => {
    render(
      <NoteAttachments
        attachmentIds={['deleted-doc']}
        documents={[]}
        onDownload={vi.fn()}
      />,
    );

    expect(screen.getByText('Attachment unavailable')).toBeInTheDocument();
  });
});
