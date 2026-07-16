import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DocumentUploadDialog } from './DocumentUploadDialog';
import type { Deal } from '@/types/deal';

const upload = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
}));

vi.mock('@/lib/api/documents', () => ({
  useUploadDocument: () => upload,
}));

const deal = { id: 'deal-1', name: 'Larkspur Apartments' } as Deal;

describe('DocumentUploadDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders as an opaque elevated dialog surface', () => {
    render(
      <DocumentUploadDialog deal={deal} open onOpenChange={vi.fn()} />,
    );

    expect(screen.getByRole('dialog')).toHaveClass('bg-[var(--paper-elevated)]', 'shadow-2xl');
  });

  it('shows a storage failure instead of an empty error', async () => {
    const user = userEvent.setup();
    upload.mutateAsync.mockRejectedValueOnce(new Error('Object storage is unavailable'));

    render(
      <DocumentUploadDialog deal={deal} open onOpenChange={vi.fn()} />,
    );

    await user.upload(
      screen.getByLabelText('File'),
      new File(['document'], 'offering.pdf', { type: 'application/pdf' }),
    );
    await user.click(screen.getByRole('button', { name: /^Upload$/i }));

    expect(await screen.findByText('Object storage is unavailable')).toBeInTheDocument();
  });
});
