import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hooks = vi.hoisted(() => ({
  create: { mutate: vi.fn(), isPending: false, isError: false, error: null as Error | null },
  update: { mutate: vi.fn(), isPending: false, isError: false, error: null as Error | null },
  remove: { mutate: vi.fn(), isPending: false, isError: false, error: null as Error | null },
  download: { mutate: vi.fn(), isPending: false },
}));

vi.mock('@/lib/api/notes', () => ({
  useCreateNote: () => hooks.create,
  useUpdateNote: () => hooks.update,
  useDeleteNote: () => hooks.remove,
}));
vi.mock('@/lib/api/documents', () => ({
  useDownloadDocument: () => hooks.download,
}));

import { DealNotesPanel } from './DealNotesPanel';
import type { DealNote } from '@/types/deal';

function note(overrides: Partial<DealNote>): DealNote {
  return {
    id: 'note-1',
    deal: 'deal-1',
    body: 'Credit review note',
    author: 1,
    author_username: 'analyst',
    can_edit: false,
    can_delete: false,
    attachments: [],
    visibility_roles: ['internal'],
    created_at: '2026-07-15T12:00:00Z',
    updated_at: '2026-07-15T12:00:00Z',
    ...overrides,
  };
}

describe('DealNotesPanel', () => {
  beforeEach(() => {
    hooks.create.isError = false;
    hooks.create.error = null;
    hooks.update.isError = false;
    hooks.update.error = null;
    hooks.remove.isError = false;
    hooks.remove.error = null;
  });

  it('renders the load failure distinctly and retries on request', async () => {
    const onRetry = vi.fn();
    render(
      <DealNotesPanel
        dealId="deal-1"
        notes={[]}
        isLoading={false}
        isError
        onRetry={onRetry}
        documents={[]}
      />,
    );

    expect(screen.getByText('Notes unavailable')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('shows mutation errors without replacing existing notes', () => {
    hooks.create.isError = true;
    hooks.create.error = new Error('Network unavailable');
    render(
      <DealNotesPanel
        dealId="deal-1"
        notes={[note({})]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        documents={[]}
      />,
    );

    expect(screen.getByText(/Couldn't add note: Network unavailable/)).toBeInTheDocument();
    expect(screen.getByText('Credit review note')).toBeInTheDocument();
  });

  it('renders edit and delete controls only from server-provided capabilities', () => {
    render(
      <DealNotesPanel
        dealId="deal-1"
        notes={[
          note({ id: 'read-only', body: 'Read only', author_username: 'other' }),
          note({ id: 'editable', body: 'Editable', can_edit: true }),
          note({ id: 'deletable', body: 'Deletable', can_delete: true }),
        ]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        documents={[]}
      />,
    );

    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);
    expect(screen.getByText(/other/)).toBeInTheDocument();
  });

  it('does not label create-time microsecond drift as an edit', () => {
    render(
      <DealNotesPanel
        dealId="deal-1"
        notes={[
          note({
            created_at: '2026-07-15T12:00:00.123456Z',
            updated_at: '2026-07-15T12:00:00.123789Z',
          }),
        ]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        documents={[]}
      />,
    );

    expect(screen.queryByText(/edited/)).not.toBeInTheDocument();
  });

  it('labels a later note update as edited', () => {
    render(
      <DealNotesPanel
        dealId="deal-1"
        notes={[note({ updated_at: '2026-07-15T12:00:01Z' })]}
        isLoading={false}
        isError={false}
        onRetry={vi.fn()}
        documents={[]}
      />,
    );

    expect(screen.getByText(/edited/)).toBeInTheDocument();
  });
});
