// Demo Closing / DD store — mirrors the Live regeneration and terminal rules at a practical level.

import demoSeed from '@shared/demo_seed.json';
import { ApiError } from '@/lib/apiError';
import type {
  ClosingDocumentSummary,
  ClosingGeneration,
  ClosingPackage,
  ConditionPrecedent,
  DDChecklistItem,
  DDTemplate,
} from '@/types/closing';

const ORDINARY_REASON = 'ordinary_regeneration';

let packageSeq = 1;
let generationSeq = 1;
let itemSeq = 1;

const packages: ClosingPackage[] = [];
const EMPTY_PACKAGE_FIELDS = {
  target_close_date: null,
  actual_close_date: null,
  funds_wired_date: null,
  funds_wired_amount: null,
  closing_attorney: '',
  title_company: '',
  purchase_price: null,
  appraised_value: null,
  final_loan_amount: null,
  closing_costs: null,
  sources_and_uses_notes: '',
  notes: '',
} satisfies Pick<
  ClosingPackage,
  | 'target_close_date'
  | 'actual_close_date'
  | 'funds_wired_date'
  | 'funds_wired_amount'
  | 'closing_attorney'
  | 'title_company'
  | 'purchase_price'
  | 'appraised_value'
  | 'final_loan_amount'
  | 'closing_costs'
  | 'sources_and_uses_notes'
  | 'notes'
>;
const generations: ClosingGeneration[] = [];
const ddItems: DDChecklistItem[] = [];
const cpItems: ConditionPrecedent[] = [];

type TemplateItemKind = 'dd' | 'cp';

function templateItems(
  prefix: string,
  rows: Array<[TemplateItemKind, number, string, string, number | null]>,
): DDTemplate['items'] {
  return rows.map(([kind, sort_order, title, description, days]) => ({
    id: `${prefix}-${kind}-${sort_order}`,
    sort_order,
    kind,
    title,
    description,
    default_days_before_target_close: days,
  }));
}

/** Mirrors api/migrations/0012_closing_dd.py seed catalogs. */
export const DEMO_DD_TEMPLATES: DDTemplate[] = [
  {
    id: 'tmpl-debt',
    key: 'debt_acquisition',
    name: 'Debt acquisition',
    description: 'Standard acquisition financing closing checklist.',
    is_active: true,
    items: templateItems('tmpl-debt', [
      ['dd', 1, 'Title commitment / proforma policy', '', 14],
      ['dd', 2, 'Survey', '', 14],
      ['dd', 3, 'Environmental (Phase I)', '', 21],
      ['dd', 4, 'Appraisal', '', 21],
      ['dd', 5, 'Insurance binder', '', 7],
      ['dd', 6, 'Entity / authority docs', '', 10],
      ['dd', 7, 'Loan documents drafted', '', 5],
      ['cp', 1, 'Executed loan documents received', '', 0],
      ['cp', 2, 'Title clear to close', '', 0],
    ]),
  },
  {
    id: 'tmpl-bridge',
    key: 'bridge_loan',
    name: 'Bridge loan',
    description: 'Shorter bridge closing checklist.',
    is_active: true,
    items: templateItems('tmpl-bridge', [
      ['dd', 1, 'Title commitment', '', 10],
      ['dd', 2, 'Insurance binder', '', 7],
      ['dd', 3, 'Entity / authority docs', '', 7],
      ['dd', 4, 'Loan documents drafted', '', 5],
      ['cp', 1, 'Executed loan documents received', '', 0],
      ['cp', 2, 'Title clear to close', '', 0],
    ]),
  },
  {
    id: 'tmpl-equity',
    key: 'equity_investment',
    name: 'Equity investment',
    description: 'General equity / hybrid investment closing checklist.',
    is_active: true,
    items: templateItems('tmpl-equity', [
      ['dd', 1, 'Entity docs', '', 14],
      ['dd', 2, 'Operating agreement / subscription docs', '', 14],
      ['dd', 3, 'Insurance (as applicable)', '', 7],
      ['dd', 4, 'Third-party reports (as applicable)', '', 21],
      ['cp', 1, 'Executed investment documents received', '', 0],
      ['cp', 2, 'KYC/AML package complete', '', 0],
    ]),
  },
];

type ClosingSeed = {
  dd_templates?: DDTemplate[];
  closing_packages?: ClosingPackage[];
  closing_generations?: ClosingGeneration[];
  dd_checklist_items?: DDChecklistItem[];
  conditions_precedent?: ConditionPrecedent[];
};

function nowIso() {
  return new Date().toISOString();
}

function page<T>(rows: T[]) {
  return { count: rows.length, next: null, previous: null, results: rows };
}

function badRequest(field: string, message: string): never {
  throw new ApiError('Validation failed', 400, { [field]: [message] });
}

function requireClosing(dealStatus: string | undefined) {
  if (dealStatus !== 'closing') {
    badRequest('deal', 'Closing checklist mutations require the deal to be in Closing.');
  }
}

function currentGeneration(packageId: string) {
  return generations.find((generation) => generation.package === packageId && generation.is_current);
}

function blocksOrdinary(generationId: string) {
  const dds = ddItems.filter((item) => item.generation === generationId);
  const cps = cpItems.filter((item) => item.generation === generationId);
  if (dds.length === 0 && cps.length === 0) return false;
  if (dds.some((item) => item.status === 'in_progress')) return true;
  if (dds.some((item) => item.status === 'complete' || item.status === 'waived' || item.documents.length)) {
    return true;
  }
  if (cps.some((item) => item.status === 'satisfied' || item.status === 'waived' || item.documents.length)) {
    return true;
  }
  if (dds.some((item) => item.status !== 'pending')) return true;
  if (cps.some((item) => item.status !== 'open')) return true;
  return false;
}

function dueDateFromOffset(targetCloseDate: string | null, offsetDays: number | null): string | null {
  if (!targetCloseDate || offsetDays === null || offsetDays === undefined) return null;
  const base = new Date(`${targetCloseDate}T00:00:00`);
  if (Number.isNaN(base.getTime())) return null;
  base.setDate(base.getDate() - offsetDays);
  const year = base.getFullYear();
  const month = String(base.getMonth() + 1).padStart(2, '0');
  const day = String(base.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function nextSortOrder(existing: Array<{ sort_order: number }>): number {
  if (existing.length === 0) return 1;
  return Math.max(...existing.map((row) => row.sort_order)) + 1;
}

function copyTemplate(generationId: string, template: DDTemplate, targetCloseDate: string | null) {
  for (const item of template.items) {
    const due_date = dueDateFromOffset(targetCloseDate, item.default_days_before_target_close);
    if (item.kind === 'dd') {
      ddItems.push({
        id: `dd-${itemSeq++}`,
        generation: generationId,
        source_template_item: item.id,
        sort_order: item.sort_order,
        title: item.title,
        description: item.description,
        status: 'pending',
        owner: null,
        due_date,
        waiver_reason: '',
        completed_at: null,
        waived_at: null,
        documents: [],
        created_at: nowIso(),
        updated_at: nowIso(),
      });
    } else {
      cpItems.push({
        id: `cp-${itemSeq++}`,
        generation: generationId,
        source_template_item: item.id,
        sort_order: item.sort_order,
        title: item.title,
        description: item.description,
        status: 'open',
        owner: null,
        due_date,
        waiver_reason: '',
        satisfied_at: null,
        waived_at: null,
        documents: [],
        created_at: nowIso(),
        updated_at: nowIso(),
      });
    }
  }
}

function bumpSeqFromId(id: string, prefix: string, current: number) {
  if (!id.startsWith(prefix)) return current;
  const parsed = Number(id.slice(prefix.length));
  return Number.isFinite(parsed) ? Math.max(current, parsed + 1) : current;
}

function loadSeed() {
  packages.length = 0;
  generations.length = 0;
  ddItems.length = 0;
  cpItems.length = 0;
  packageSeq = 1;
  generationSeq = 1;
  itemSeq = 1;

  const seed = demoSeed as unknown as ClosingSeed;
  for (const row of seed.closing_packages ?? []) {
    packages.push({ ...EMPTY_PACKAGE_FIELDS, ...row });
    packageSeq = bumpSeqFromId(row.id, 'cpkg-', packageSeq);
  }
  for (const row of seed.closing_generations ?? []) {
    generations.push({ ...row });
    generationSeq = bumpSeqFromId(row.id, 'cgen-', generationSeq);
  }
  for (const row of seed.dd_checklist_items ?? []) {
    ddItems.push({ ...row, documents: [...(row.documents ?? [])] });
    itemSeq = bumpSeqFromId(row.id, 'dd-', itemSeq);
  }
  for (const row of seed.conditions_precedent ?? []) {
    cpItems.push({ ...row, documents: [...(row.documents ?? [])] });
    itemSeq = bumpSeqFromId(row.id, 'cp-', itemSeq);
  }
}

loadSeed();

function isGenerateAction(id?: string, action?: string) {
  return action === 'generate' || id === 'generate';
}

function documentVisible(doc: ClosingDocumentSummary, isStaff: boolean) {
  if (isStaff) return true;
  return (doc.visibility_roles ?? ['internal']).includes('internal');
}

function withVisibleDocuments<T extends { documents: ClosingDocumentSummary[] }>(
  item: T,
  isStaff: boolean,
): T {
  return {
    ...item,
    documents: item.documents.filter((doc) => documentVisible(doc, isStaff)),
  };
}

function setItemDocuments(
  item: DDChecklistItem | ConditionPrecedent,
  documentIds: string[],
  resolveDocuments: ((ids: string[]) => ClosingDocumentSummary[]) | undefined,
  terminal: boolean,
  isStaff: boolean,
) {
  const resolved = resolveDocuments?.(documentIds) ?? [];
  if (resolved.length !== documentIds.length) {
    badRequest('document_ids', 'One or more documents are not available.');
  }
  const invisibleExisting = item.documents.filter((doc) => !documentVisible(doc, isStaff));
  if (terminal) {
    for (const existing of item.documents) {
      if (!documentVisible(existing, isStaff)) continue;
      if (!documentIds.includes(existing.id)) {
        badRequest('document_ids', 'Terminal evidence cannot remove documents.');
      }
    }
  }
  const byId = new Map<string, ClosingDocumentSummary>();
  for (const doc of resolved) byId.set(doc.id, doc);
  for (const doc of invisibleExisting) {
    if (!byId.has(doc.id)) byId.set(doc.id, doc);
  }
  item.documents = [
    ...documentIds.map((id) => byId.get(id)!).filter(Boolean),
    ...invisibleExisting.filter((doc) => !documentIds.includes(doc.id)),
  ];
  item.updated_at = nowIso();
  return withVisibleDocuments(item, isStaff);
}

function applyItemFields(
  item: DDChecklistItem | ConditionPrecedent,
  body: Record<string, unknown> | null,
) {
  if (typeof body?.title === 'string') {
    const title = body.title.trim();
    if (title) item.title = title;
  }
  if ('description' in (body ?? {})) item.description = String(body?.description ?? '');
  if ('owner' in (body ?? {})) {
    const owner = body?.owner;
    if (owner === null || owner === undefined || owner === '') {
      item.owner = null;
    } else {
      const ownerId = Number(owner);
      // Demo assignee list is the primary analyst (id 1); reject arbitrary owners.
      if (!Number.isFinite(ownerId) || ownerId !== 1) {
        badRequest('owner', 'Owner must be the assigned analyst or an active staff user.');
      }
      item.owner = ownerId;
    }
  }
  if ('due_date' in (body ?? {})) {
    item.due_date = (body?.due_date as string | null) ?? null;
  }
}

function activeTemplates(): DDTemplate[] {
  const seeded = (demoSeed as unknown as ClosingSeed).dd_templates;
  return seeded?.length ? seeded : DEMO_DD_TEMPLATES;
}

/** Resolve deal id from a closing entity (package / generation / item). */
export function resolveClosingDealId(args: {
  resource: string;
  id?: string;
  action?: string;
  query: URLSearchParams;
  body: Record<string, unknown> | null;
}): string | undefined {
  const fromBody = typeof args.body?.deal === 'string' ? args.body.deal : undefined;
  const fromQuery = args.query.get('deal') ?? undefined;
  if (fromBody) return fromBody;
  if (fromQuery) return fromQuery;

  const { resource, id } = args;
  if (!id) return undefined;

  if (resource === 'closing-packages') {
    return packages.find((row) => row.id === id)?.deal;
  }
  if (resource === 'closing-generations') {
    const generation = generations.find((row) => row.id === id);
    return generation ? packages.find((row) => row.id === generation.package)?.deal : undefined;
  }
  if (resource === 'dd-checklist-items') {
    const item = ddItems.find((row) => row.id === id);
    if (!item) return undefined;
    const generation = generations.find((row) => row.id === item.generation);
    return generation ? packages.find((row) => row.id === generation.package)?.deal : undefined;
  }
  if (resource === 'conditions-precedent') {
    const item = cpItems.find((row) => row.id === id);
    if (!item) return undefined;
    const generation = generations.find((row) => row.id === item.generation);
    return generation ? packages.find((row) => row.id === generation.package)?.deal : undefined;
  }
  return undefined;
}

export function closingReadinessBlockers(dealId: string): string[] {
  const pkg = packages.find((row) => row.deal === dealId);
  if (!pkg) return ['closing_package_required'];
  const blockers: string[] = [];
  if (
    !pkg.actual_close_date
    || !pkg.funds_wired_date
    || !pkg.funds_wired_amount
    || !pkg.final_loan_amount
    || !pkg.closing_attorney
    || !pkg.title_company
  ) {
    blockers.push('closing_funding_details_incomplete');
  }
  const generation = generations.find((row) => row.package === pkg.id && row.is_current);
  if (!generation) {
    blockers.push('closing_checklist_required');
    return blockers;
  }
  if (ddItems.some(
    (row) => row.generation === generation.id && !['complete', 'waived'].includes(row.status),
  )) {
    blockers.push('closing_dd_incomplete');
  }
  if (cpItems.some(
    (row) => row.generation === generation.id && !['satisfied', 'waived'].includes(row.status),
  )) {
    blockers.push('closing_cp_incomplete');
  }
  return blockers;
}

/** True when a document id is linked to any DD/CP checklist item. */
export function documentIsClosingLinked(documentId: string): boolean {
  return (
    ddItems.some((item) => item.documents.some((doc) => doc.id === documentId)) ||
    cpItems.some((item) => item.documents.some((doc) => doc.id === documentId))
  );
}

export function handleClosingRequest(args: {
  method: string;
  resource: string;
  id?: string;
  action?: string;
  query: URLSearchParams;
  body: Record<string, unknown> | null;
  dealStatus?: string;
  isStaff?: boolean;
  resolveDocuments?: (ids: string[]) => ClosingDocumentSummary[];
}): unknown | null {
  const { method, resource, id, action, query, body, resolveDocuments } = args;
  const dealStatus = args.dealStatus;
  const isStaff = Boolean(args.isStaff);

  if (resource === 'dd-templates') {
    if (method !== 'GET') {
      throw new ApiError('Method not allowed', 405, { detail: 'Method not allowed.' });
    }
    return page(activeTemplates());
  }

  if (resource === 'closing-packages') {
    if (method === 'GET' && !id) {
      const dealId = query.get('deal');
      const rows = packages.filter((row) => !dealId || row.deal === dealId);
      return page(rows);
    }
    if (method === 'GET' && id && action === 'assignees') {
      return [{ id: 1, username: 'demo' }];
    }
    if (method === 'GET' && id) {
      const row = packages.find((item) => item.id === id);
      if (!row) throw new ApiError('Not found', 404, { detail: 'Not found.' });
      return row;
    }
    if (method === 'POST' && isGenerateAction(id, action)) {
      requireClosing(dealStatus);
      const dealId = String(body?.deal ?? '');
      const template = activeTemplates().find((item) => item.id === body?.template_id);
      if (!template) badRequest('template_id', 'Selected template is not available.');
      let pkg = packages.find((item) => item.deal === dealId);
      if (!pkg) {
        pkg = {
          id: `cpkg-${packageSeq++}`,
          deal: dealId,
          ...EMPTY_PACKAGE_FIELDS,
          target_close_date: (body?.target_close_date as string | null) ?? null,
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        packages.push(pkg);
      }
      // Live ignores generation dates for existing packages; Demo matches.
      // Callers must save the package first if they want a new target close date.
      const current = currentGeneration(pkg.id);
      const force = Boolean(body?.force);
      const blocked = Boolean(current && blocksOrdinary(current.id));
      if (blocked && !force) {
        badRequest('template', 'Current checklist cannot be regenerated.');
      }
      if (force && current) {
        if (!isStaff) {
          badRequest('force', 'Only staff may force supersede a checklist.');
        }
        if (!String(body?.force_reason ?? '').trim()) {
          badRequest('force_reason', 'A reason is required to force supersede.');
        }
      }
      if (current) {
        current.is_current = false;
        current.superseded_at = nowIso();
        current.supersede_reason =
          force ? String(body?.force_reason ?? '').trim() : ORDINARY_REASON;
      }
      const generation: ClosingGeneration = {
        id: `cgen-${generationSeq++}`,
        package: pkg.id,
        version: current ? current.version + 1 : 1,
        template: template.id,
        template_key: template.key,
        template_name: template.name,
        is_current: true,
        generated_at: nowIso(),
        generated_by: 1,
        superseded_at: null,
        superseded_by: null,
        supersede_reason: '',
      };
      generations.push(generation);
      copyTemplate(generation.id, template, pkg.target_close_date);
      return generation;
    }
    if (method === 'POST') {
      requireClosing(dealStatus);
      const dealId = String(body?.deal ?? '');
      const existing = packages.find((item) => item.deal === dealId);
      if (!existing) {
        const created: ClosingPackage = {
          id: `cpkg-${packageSeq++}`,
          deal: dealId,
          ...EMPTY_PACKAGE_FIELDS,
          target_close_date: (body?.target_close_date as string | null) ?? null,
          notes: String(body?.notes ?? ''),
          created_at: nowIso(),
          updated_at: nowIso(),
        };
        packages.push(created);
        return created;
      }
      applyPackageBody(existing, body ?? {});
      existing.updated_at = nowIso();
      return existing;
    }
    if (method === 'PATCH' && id) {
      requireClosing(dealStatus);
      const existing = packages.find((item) => item.id === id);
      if (!existing) throw new ApiError('Not found', 404, { detail: 'Not found.' });
      applyPackageBody(existing, body ?? {});
      existing.updated_at = nowIso();
      return existing;
    }
  }

  if (resource === 'closing-generations' && method === 'GET') {
    const dealId = query.get('deal');
    const pkgIds = new Set(
      packages.filter((item) => !dealId || item.deal === dealId).map((item) => item.id),
    );
    let rows = generations.filter((item) => pkgIds.has(item.package));
    if (query.get('current') === '1') rows = rows.filter((item) => item.is_current);
    return page(rows.sort((a, b) => b.version - a.version));
  }

  if (resource === 'dd-checklist-items') {
    if (method === 'GET') {
      const dealId = query.get('deal');
      const pkgIds = new Set(
        packages.filter((item) => !dealId || item.deal === dealId).map((item) => item.id),
      );
      const genIds = new Set(
        generations
          .filter((item) => pkgIds.has(item.package) && (query.get('current') !== '1' || item.is_current))
          .map((item) => item.id),
      );
      return page(
        ddItems
          .filter((item) => genIds.has(item.generation))
          .map((item) => withVisibleDocuments(item, isStaff)),
      );
    }
    if (method === 'POST' && action === 'documents' && id) {
      requireClosing(dealStatus);
      const item = ddItems.find((row) => row.id === id);
      if (!item) throw new ApiError('Not found', 404, { detail: 'Not found.' });
      const generation = generations.find((row) => row.id === item.generation);
      if (!generation?.is_current) badRequest('generation', 'Prior checklist generations are immutable.');
      const terminal = item.status === 'complete' || item.status === 'waived';
      const ids = Array.isArray(body?.document_ids) ? (body!.document_ids as string[]) : [];
      return setItemDocuments(item, ids, resolveDocuments, terminal, isStaff);
    }
    if (method === 'POST' && !id) {
      requireClosing(dealStatus);
      const dealId = String(body?.deal ?? '');
      const pkg = packages.find((item) => item.deal === dealId);
      const current = pkg ? currentGeneration(pkg.id) : null;
      if (!current) badRequest('generation', 'Generate a checklist before adding items.');
      const title = String(body?.title ?? '').trim();
      if (!title) badRequest('title', 'Title is required.');
      const siblings = ddItems.filter((row) => row.generation === current.id);
      const owner =
        body?.owner === null || body?.owner === undefined || body?.owner === ''
          ? null
          : Number(body.owner);
      const item: DDChecklistItem = {
        id: `dd-${itemSeq++}`,
        generation: current.id,
        source_template_item: null,
        sort_order: nextSortOrder(siblings),
        title,
        description: String(body?.description ?? ''),
        status: 'pending',
        owner: Number.isFinite(owner as number) ? (owner as number) : null,
        due_date: (body?.due_date as string | null) ?? null,
        waiver_reason: '',
        completed_at: null,
        waived_at: null,
        documents: [],
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      ddItems.push(item);
      return withVisibleDocuments(item, isStaff);
    }
    if (method === 'PATCH' && id) {
      requireClosing(dealStatus);
      const item = ddItems.find((row) => row.id === id);
      if (!item) throw new ApiError('Not found', 404, { detail: 'Not found.' });
      const generation = generations.find((row) => row.id === item.generation);
      if (!generation?.is_current) badRequest('generation', 'Prior checklist generations are immutable.');
      if (item.status === 'complete' || item.status === 'waived') {
        badRequest('status', 'Terminal DD items are immutable.');
      }
      applyItemFields(item, body);
      if (typeof body?.status === 'string') {
        if (!['pending', 'in_progress', 'complete', 'waived'].includes(body.status)) {
          badRequest('status', 'Unsupported DD status.');
        }
        if (body.status === 'waived' && !String(body.waiver_reason ?? '').trim()) {
          badRequest('waiver_reason', 'A waiver reason is required.');
        }
        item.status = body.status as DDChecklistItem['status'];
        if (item.status === 'complete') item.completed_at = nowIso();
        if (item.status === 'waived') {
          item.waived_at = nowIso();
          item.waiver_reason = String(body.waiver_reason ?? '');
        }
        if (item.status === 'pending' || item.status === 'in_progress') {
          item.completed_at = null;
          item.waived_at = null;
          item.waiver_reason = '';
        }
      }
      item.updated_at = nowIso();
      return withVisibleDocuments(item, isStaff);
    }
    if (method === 'DELETE' && id) {
      requireClosing(dealStatus);
      const index = ddItems.findIndex((row) => row.id === id);
      if (index < 0) throw new ApiError('Not found', 404, { detail: 'Not found.' });
      const generation = generations.find((row) => row.id === ddItems[index].generation);
      if (!generation?.is_current) badRequest('generation', 'Prior checklist generations are immutable.');
      if (ddItems[index].status !== 'pending') badRequest('status', 'Only pending DD items can be deleted.');
      ddItems.splice(index, 1);
      return {};
    }
  }

  if (resource === 'conditions-precedent') {
    if (method === 'GET') {
      const dealId = query.get('deal');
      const pkgIds = new Set(
        packages.filter((item) => !dealId || item.deal === dealId).map((item) => item.id),
      );
      const genIds = new Set(
        generations
          .filter((item) => pkgIds.has(item.package) && (query.get('current') !== '1' || item.is_current))
          .map((item) => item.id),
      );
      return page(
        cpItems
          .filter((item) => genIds.has(item.generation))
          .map((item) => withVisibleDocuments(item, isStaff)),
      );
    }
    if (method === 'POST' && action === 'documents' && id) {
      requireClosing(dealStatus);
      const item = cpItems.find((row) => row.id === id);
      if (!item) throw new ApiError('Not found', 404, { detail: 'Not found.' });
      const generation = generations.find((row) => row.id === item.generation);
      if (!generation?.is_current) badRequest('generation', 'Prior checklist generations are immutable.');
      const terminal = item.status === 'satisfied' || item.status === 'waived';
      const ids = Array.isArray(body?.document_ids) ? (body!.document_ids as string[]) : [];
      return setItemDocuments(item, ids, resolveDocuments, terminal, isStaff);
    }
    if (method === 'POST' && !id) {
      requireClosing(dealStatus);
      const dealId = String(body?.deal ?? '');
      const pkg = packages.find((item) => item.deal === dealId);
      const current = pkg ? currentGeneration(pkg.id) : null;
      if (!current) badRequest('generation', 'Generate a checklist before adding items.');
      const title = String(body?.title ?? '').trim();
      if (!title) badRequest('title', 'Title is required.');
      const siblings = cpItems.filter((row) => row.generation === current.id);
      const owner =
        body?.owner === null || body?.owner === undefined || body?.owner === ''
          ? null
          : Number(body.owner);
      const item: ConditionPrecedent = {
        id: `cp-${itemSeq++}`,
        generation: current.id,
        source_template_item: null,
        sort_order: nextSortOrder(siblings),
        title,
        description: String(body?.description ?? ''),
        status: 'open',
        owner: Number.isFinite(owner as number) ? (owner as number) : null,
        due_date: (body?.due_date as string | null) ?? null,
        waiver_reason: '',
        satisfied_at: null,
        waived_at: null,
        documents: [],
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      cpItems.push(item);
      return withVisibleDocuments(item, isStaff);
    }
    if (method === 'PATCH' && id) {
      requireClosing(dealStatus);
      const item = cpItems.find((row) => row.id === id);
      if (!item) throw new ApiError('Not found', 404, { detail: 'Not found.' });
      const generation = generations.find((row) => row.id === item.generation);
      if (!generation?.is_current) badRequest('generation', 'Prior checklist generations are immutable.');
      if (item.status === 'satisfied' || item.status === 'waived') {
        badRequest('status', 'Terminal conditions precedent are immutable.');
      }
      applyItemFields(item, body);
      if (typeof body?.status === 'string') {
        if (!['open', 'satisfied', 'waived'].includes(body.status)) {
          badRequest('status', 'Unsupported condition precedent status.');
        }
        if (body.status === 'waived' && !String(body.waiver_reason ?? '').trim()) {
          badRequest('waiver_reason', 'A waiver reason is required.');
        }
        item.status = body.status as ConditionPrecedent['status'];
        if (item.status === 'satisfied') item.satisfied_at = nowIso();
        if (item.status === 'waived') {
          item.waived_at = nowIso();
          item.waiver_reason = String(body.waiver_reason ?? '');
        }
        if (item.status === 'open') {
          item.satisfied_at = null;
          item.waived_at = null;
          item.waiver_reason = '';
        }
      }
      item.updated_at = nowIso();
      return withVisibleDocuments(item, isStaff);
    }
    if (method === 'DELETE' && id) {
      requireClosing(dealStatus);
      const index = cpItems.findIndex((row) => row.id === id);
      if (index < 0) throw new ApiError('Not found', 404, { detail: 'Not found.' });
      const generation = generations.find((row) => row.id === cpItems[index].generation);
      if (!generation?.is_current) badRequest('generation', 'Prior checklist generations are immutable.');
      if (cpItems[index].status !== 'open') {
        badRequest('status', 'Only open conditions precedent can be deleted.');
      }
      cpItems.splice(index, 1);
      return {};
    }
  }

  return null;
}

function applyPackageBody(pkg: ClosingPackage, body: Record<string, unknown>): void {
  const dateFields = ['target_close_date', 'actual_close_date', 'funds_wired_date'] as const;
  const moneyFields = [
    'funds_wired_amount',
    'purchase_price',
    'appraised_value',
    'final_loan_amount',
    'closing_costs',
  ] as const;
  const textFields = [
    'closing_attorney',
    'title_company',
    'sources_and_uses_notes',
    'notes',
  ] as const;
  for (const field of dateFields) {
    if (field in body) pkg[field] = body[field] ? String(body[field]) : null;
  }
  for (const field of moneyFields) {
    if (field in body) pkg[field] = body[field] ? String(body[field]) : null;
  }
  for (const field of textFields) {
    if (field in body) pkg[field] = String(body[field] ?? '');
  }
}

export function resetClosingMocks() {
  loadSeed();
}
