import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthContext } from '@/context/AuthContext';
import DealClosingPage from './DealClosingPage';

const hooks = vi.hoisted(() => ({
  authUser: { username: 'demo', email: 'demo@example.com', is_staff: true } as {
    username: string;
    email: string;
    is_staff: boolean;
  } | null,
  deal: {
    data: {
      id: 'deal-1',
      name: 'Test Deal',
      pipeline_status: 'closing',
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  closingPackage: {
    data: null as null | { id: string; target_close_date: string | null; notes: string },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  generations: {
    data: [] as Array<{
      id: string;
      version: number;
      is_current: boolean;
      template_name: string;
      generated_at: string;
      supersede_reason: string;
    }>,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  ddItems: {
    data: [] as Array<Record<string, unknown>>,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  cpItems: {
    data: [] as Array<Record<string, unknown>>,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  templates: {
    data: [{ id: 'tmpl-1', name: 'Debt acquisition' }],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  documents: {
    data: [] as Array<Record<string, unknown>>,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  assignees: { data: [{ id: 1, username: 'demo' }], isLoading: false, isError: false },
  generate: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
  updateDD: { mutate: vi.fn() },
  updateCP: { mutate: vi.fn() },
  createDD: { mutate: vi.fn() },
  createCP: { mutate: vi.fn() },
  deleteDD: { mutate: vi.fn() },
  deleteCP: { mutate: vi.fn() },
  setDDDocs: { mutate: vi.fn() },
  setCPDocs: { mutate: vi.fn() },
  upsert: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
  patch: { mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false },
  download: { mutate: vi.fn(), isPending: false },
}));

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query');
  return {
    ...actual,
    useQueryClient: () => ({
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    }),
  };
});

vi.mock('@/lib/api/deals', () => ({
  useDeal: () => hooks.deal,
  useDealDocuments: () => hooks.documents,
}));

vi.mock('@/lib/api/documents', () => ({
  useDownloadDocument: () => hooks.download,
}));

vi.mock('@/lib/api/closing', () => ({
  useClosingPackage: () => hooks.closingPackage,
  useClosingGenerations: () => hooks.generations,
  useDealDDItems: () => hooks.ddItems,
  useDealCPItems: () => hooks.cpItems,
  useCurrentDDItems: () => hooks.ddItems,
  useCurrentCPItems: () => hooks.cpItems,
  useDDTemplates: () => hooks.templates,
  useClosingAssignees: () => hooks.assignees,
  useUpsertClosingPackage: () => hooks.upsert,
  usePatchClosingPackage: () => hooks.patch,
  useGenerateClosingChecklist: () => hooks.generate,
  useUpdateDDItem: () => hooks.updateDD,
  useUpdateCPItem: () => hooks.updateCP,
  useCreateDDItem: () => hooks.createDD,
  useCreateCPItem: () => hooks.createCP,
  useDeleteDDItem: () => hooks.deleteDD,
  useDeleteCPItem: () => hooks.deleteCP,
  useSetDDDocuments: () => hooks.setDDDocs,
  useSetCPDocuments: () => hooks.setCPDocs,
}));

function renderPage() {
  return render(
    <AuthContext.Provider
      value={{
        user: hooks.authUser,
        isAuthenticated: Boolean(hooks.authUser),
        isLoading: false,
        error: null,
        login: vi.fn(),
        logout: vi.fn(),
      }}
    >
      <MemoryRouter initialEntries={['/deals/deal-1/closing']}>
        <Routes>
          <Route path="/deals/:id/closing" element={<DealClosingPage />} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('DealClosingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hooks.authUser = { username: 'demo', email: 'demo@example.com', is_staff: true };
    hooks.deal.data = {
      id: 'deal-1',
      name: 'Test Deal',
      pipeline_status: 'closing',
    };
    hooks.closingPackage.data = null;
    hooks.generations.data = [];
    hooks.ddItems.data = [];
    hooks.cpItems.data = [];
    hooks.documents.data = [];
    hooks.generate.mutateAsync.mockResolvedValue({
      id: 'g-new',
      version: 1,
      is_current: true,
      template_name: 'Debt acquisition',
    });
    hooks.patch.mutateAsync.mockResolvedValue({
      id: 'cpkg-1',
      target_close_date: null,
      notes: '',
    });
    hooks.upsert.mutateAsync.mockResolvedValue({
      id: 'cpkg-1',
      target_close_date: null,
      notes: '',
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'prompt').mockReturnValue('Sponsor delay');
  });

  it('shows enforced Closed readiness messaging and generate controls while Closing', () => {
    renderPage();
    expect(screen.getByText(/Closing → Closed requires/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Generate checklist' })).toBeVisible();
  });

  it('shows the due-date warning on the package panel', () => {
    renderPage();
    expect(
      screen.getByText(/Changing the target close date does not move existing item due dates/i),
    ).toBeVisible();
  });

  it('is read-only outside Closing', () => {
    hooks.deal.data = { ...hooks.deal.data, pipeline_status: 'signed' };
    hooks.generations.data = [
      {
        id: 'g1',
        version: 1,
        is_current: true,
        template_name: 'Debt acquisition',
        generated_at: '2026-06-20T15:00:00.000Z',
        supersede_reason: '',
      },
    ];
    renderPage();
    expect(screen.getByText(/history is read-only/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: /Generate checklist|Regenerate/i })).toBeNull();
  });

  it('shows force supersede only for staff when a current generation exists', () => {
    hooks.generations.data = [
      {
        id: 'g1',
        version: 1,
        is_current: true,
        template_name: 'Debt acquisition',
        generated_at: '2026-06-20T15:00:00.000Z',
        supersede_reason: '',
      },
    ];
    const { unmount } = renderPage();
    expect(screen.getByText(/Staff force supersede/i)).toBeVisible();
    unmount();

    hooks.authUser = { username: 'analyst', email: 'a@example.com', is_staff: false };
    renderPage();
    expect(screen.queryByText(/Staff force supersede/i)).toBeNull();
  });

  it('requires a waiver reason when waiving a DD item', async () => {
    const user = userEvent.setup();
    hooks.generations.data = [
      {
        id: 'g1',
        version: 1,
        is_current: true,
        template_name: 'Debt acquisition',
        generated_at: '2026-06-20T15:00:00.000Z',
        supersede_reason: '',
      },
    ];
    hooks.ddItems.data = [
      {
        id: 'dd-1',
        generation: 'g1',
        title: 'Title work',
        description: '',
        status: 'pending',
        owner: null,
        due_date: null,
        documents: [],
      },
    ];
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Waive' }));
    expect(hooks.updateDD.mutate).toHaveBeenCalledWith(
      { itemId: 'dd-1', payload: { status: 'waived', waiver_reason: 'Sponsor delay' } },
      expect.any(Object),
    );
  });

  it('hides mutation actions for terminal items', () => {
    hooks.generations.data = [
      {
        id: 'g1',
        version: 1,
        is_current: true,
        template_name: 'Debt acquisition',
        generated_at: '2026-06-20T15:00:00.000Z',
        supersede_reason: '',
      },
    ];
    hooks.ddItems.data = [
      {
        id: 'dd-1',
        generation: 'g1',
        title: 'Title work',
        description: '',
        status: 'complete',
        owner: null,
        due_date: null,
        documents: [],
      },
    ];
    renderPage();
    expect(screen.queryByRole('button', { name: 'Complete' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Waive' })).toBeNull();
  });

  it('shows prior-generation items read-only when a superseded generation is selected', async () => {
    const user = userEvent.setup();
    hooks.generations.data = [
      {
        id: 'g2',
        version: 2,
        is_current: true,
        template_name: 'Debt acquisition',
        generated_at: '2026-06-21T15:00:00.000Z',
        supersede_reason: '',
      },
      {
        id: 'g1',
        version: 1,
        is_current: false,
        template_name: 'Debt acquisition',
        generated_at: '2026-06-20T15:00:00.000Z',
        supersede_reason: 'ordinary_regeneration',
      },
    ];
    hooks.ddItems.data = [
      {
        id: 'dd-old',
        generation: 'g1',
        title: 'Prior title work',
        description: '',
        status: 'pending',
        owner: null,
        due_date: null,
        documents: [],
      },
      {
        id: 'dd-new',
        generation: 'g2',
        title: 'Current title work',
        description: '',
        status: 'pending',
        owner: null,
        due_date: null,
        documents: [],
      },
    ];
    renderPage();
    expect(screen.getByText('Current title work')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /v1 · Debt acquisition/i }));
    expect(screen.getByText('Prior title work')).toBeVisible();
    expect(screen.getByText(/viewing v1 \(read-only\)/i)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Waive' })).toBeNull();
  });

  it('saves package notes and target close date together', async () => {
    const user = userEvent.setup();
    hooks.closingPackage.data = {
      id: 'cpkg-1',
      target_close_date: null,
      notes: '',
    };
    renderPage();
    await user.type(screen.getByLabelText(/^Notes$/i), 'Wire instructions TBD');
    await user.type(screen.getByLabelText(/Target close date/i), '2026-08-01');
    await user.click(screen.getByRole('button', { name: 'Save package' }));
    expect(hooks.patch.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        packageId: 'cpkg-1',
        payload: expect.objectContaining({ target_close_date: '2026-08-01', notes: 'Wire instructions TBD' }),
      }),
      expect.any(Object),
    );
  });

  it('saves dirty package before generate and omits generation target date', async () => {
    const user = userEvent.setup();
    hooks.closingPackage.data = {
      id: 'cpkg-1',
      target_close_date: null,
      notes: '',
    };
    hooks.patch.mutateAsync.mockResolvedValue({
      id: 'cpkg-1',
      target_close_date: '2026-09-15',
      notes: '',
    });
    hooks.generate.mutateAsync.mockResolvedValue({
      id: 'g-new',
      version: 1,
      is_current: true,
      template_name: 'Debt acquisition',
    });
    renderPage();
    await user.selectOptions(screen.getByLabelText(/Template/i), 'tmpl-1');
    await user.type(screen.getByLabelText(/Target close date/i), '2026-09-15');
    await user.click(screen.getByRole('button', { name: 'Generate checklist' }));
    expect(hooks.patch.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      packageId: 'cpkg-1',
      payload: expect.objectContaining({ target_close_date: '2026-09-15', notes: '' }),
    }));
    expect(hooks.generate.mutateAsync).toHaveBeenCalledWith({
      template_id: 'tmpl-1',
      force: false,
      force_reason: '',
    });
    expect(hooks.generate.mutateAsync.mock.invocationCallOrder[0]).toBeGreaterThan(
      hooks.patch.mutateAsync.mock.invocationCallOrder[0],
    );
  });

  it('keeps the new generation selected after regenerate invalidation', async () => {
    const user = userEvent.setup();
    hooks.closingPackage.data = {
      id: 'cpkg-1',
      target_close_date: '2026-08-01',
      notes: '',
    };
    hooks.generations.data = [
      {
        id: 'g1',
        version: 1,
        is_current: true,
        template_name: 'Debt acquisition',
        generated_at: '2026-06-20T15:00:00.000Z',
        supersede_reason: '',
      },
    ];
    hooks.generate.mutateAsync.mockResolvedValue({
      id: 'g2',
      version: 2,
      is_current: true,
      template_name: 'Debt acquisition',
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderPage();
    await user.selectOptions(screen.getByLabelText(/Template/i), 'tmpl-1');
    await user.click(screen.getByRole('button', { name: /Regenerate \/ supersede/i }));
    expect(hooks.generate.mutateAsync).toHaveBeenCalled();
    // Selection is applied after invalidateQueries resolves; notice proves we kept v2.
    expect(await screen.findByText(/Checklist v2 is current/i)).toBeVisible();
    expect(screen.queryByText(/read-only/i)).toBeNull();
  });

  it('disables generate while package save or generate is in flight', async () => {
    const user = userEvent.setup();
    hooks.closingPackage.data = {
      id: 'cpkg-1',
      target_close_date: null,
      notes: '',
    };
    let resolvePatch: (value: unknown) => void = () => undefined;
    hooks.patch.mutateAsync.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePatch = resolve;
        }),
    );
    hooks.generate.mutateAsync.mockResolvedValue({
      id: 'g-new',
      version: 1,
      is_current: true,
      template_name: 'Debt acquisition',
    });
    renderPage();
    await user.selectOptions(screen.getByLabelText(/Template/i), 'tmpl-1');
    await user.type(screen.getByLabelText(/Target close date/i), '2026-09-15');
    const button = screen.getByRole('button', { name: 'Generate checklist' });
    await user.click(button);
    expect(button).toBeDisabled();
    expect(hooks.patch.mutateAsync).toHaveBeenCalledTimes(1);
    expect(hooks.generate.mutateAsync).not.toHaveBeenCalled();
    resolvePatch({ id: 'cpkg-1', target_close_date: '2026-09-15', notes: '' });
    expect(await screen.findByText(/Checklist v1 is current/i)).toBeVisible();
    expect(hooks.generate.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it('attaches a ready document to a DD item', async () => {
    const user = userEvent.setup();
    hooks.generations.data = [
      {
        id: 'g1',
        version: 1,
        is_current: true,
        template_name: 'Debt acquisition',
        generated_at: '2026-06-20T15:00:00.000Z',
        supersede_reason: '',
      },
    ];
    hooks.ddItems.data = [
      {
        id: 'dd-1',
        generation: 'g1',
        title: 'Title work',
        description: '',
        status: 'pending',
        owner: null,
        due_date: null,
        documents: [],
      },
    ];
    hooks.documents.data = [
      {
        id: 'doc-1',
        document_name: 'Title commitment.pdf',
        storage_status: 'ready',
        category: 'legal',
      },
    ];
    renderPage();
    await user.selectOptions(screen.getByLabelText(/Attach document to Title work/i), 'doc-1');
    expect(hooks.setDDDocs.mutate).toHaveBeenCalledWith(
      { itemId: 'dd-1', documentIds: ['doc-1'] },
      expect.any(Object),
    );
  });
});
