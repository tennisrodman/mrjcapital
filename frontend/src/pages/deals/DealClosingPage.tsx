import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, Pencil, Plus, Trash2 } from 'lucide-react';

import { Panel } from '@/components/deals/Panel';
import { ErrorState, Spinner } from '@/components/deals/States';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNative } from '@/components/ui/select-native';
import { Textarea } from '@/components/ui/textarea';
import { AuthContext } from '@/context/AuthContext';
import {
  useClosingAssignees,
  useClosingGenerations,
  useClosingPackage,
  useCreateCPItem,
  useCreateDDItem,
  useDealCPItems,
  useDealDDItems,
  useDDTemplates,
  useDeleteCPItem,
  useDeleteDDItem,
  useGenerateClosingChecklist,
  usePatchClosingPackage,
  useSetCPDocuments,
  useSetDDDocuments,
  useUpdateCPItem,
  useUpdateDDItem,
  useUpsertClosingPackage,
} from '@/lib/api/closing';
import { useDeal, useDealDocuments } from '@/lib/api/deals';
import { useDownloadDocument } from '@/lib/api/documents';
import { apiErrorMessage } from '@/lib/apiError';
import { cpCleared, ddCleared } from '@/types/closing';
import type {
  ClosingAssignee,
  ClosingDocumentSummary,
  ClosingGeneration,
  ConditionPrecedent,
  DDChecklistItem,
} from '@/types/closing';
import type { DealDocument } from '@/types/deal';

export default function DealClosingPage({ dealId: dealIdProp }: { dealId?: string }) {
  const { id: routeDealId } = useParams<{ id: string }>();
  const dealId = dealIdProp ?? routeDealId;
  if (!dealId) {
    return <ErrorState title="Deal is required" message="Open closing from a specific deal." />;
  }
  return <ClosingWorkspace key={dealId} dealId={dealId} />;
}

function ClosingWorkspace({ dealId }: { dealId: string }) {
  const { user } = useContext(AuthContext);
  const isStaff = Boolean(user?.is_staff);
  const queryClient = useQueryClient();
  const generateInFlight = useRef(false);
  const [generateBusy, setGenerateBusy] = useState(false);

  const dealQuery = useDeal(dealId);
  const packageQuery = useClosingPackage(dealId);
  const generationsQuery = useClosingGenerations(dealId);
  const ddQuery = useDealDDItems(dealId);
  const cpQuery = useDealCPItems(dealId);
  const templatesQuery = useDDTemplates();
  const documentsQuery = useDealDocuments(dealId);

  const closingPackage = packageQuery.data;
  const assigneesQuery = useClosingAssignees(closingPackage?.id);

  const upsertPackage = useUpsertClosingPackage(dealId);
  const patchPackage = usePatchClosingPackage(dealId);
  const generate = useGenerateClosingChecklist(dealId);
  const updateDD = useUpdateDDItem(dealId);
  const updateCP = useUpdateCPItem(dealId);
  const createDD = useCreateDDItem(dealId);
  const createCP = useCreateCPItem(dealId);
  const deleteDD = useDeleteDDItem(dealId);
  const deleteCP = useDeleteCPItem(dealId);
  const setDDDocs = useSetDDDocuments(dealId);
  const setCPDocs = useSetCPDocuments(dealId);
  const downloadDocument = useDownloadDocument();

  const [banner, setBanner] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState('');
  const [force, setForce] = useState(false);
  const [forceReason, setForceReason] = useState('');
  const [targetClose, setTargetClose] = useState('');
  const [actualClose, setActualClose] = useState('');
  const [fundsWiredDate, setFundsWiredDate] = useState('');
  const [fundsWiredAmount, setFundsWiredAmount] = useState('');
  const [closingAttorney, setClosingAttorney] = useState('');
  const [titleCompany, setTitleCompany] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [appraisedValue, setAppraisedValue] = useState('');
  const [finalLoanAmount, setFinalLoanAmount] = useState('');
  const [closingCosts, setClosingCosts] = useState('');
  const [sourcesAndUsesNotes, setSourcesAndUsesNotes] = useState('');
  const [notes, setNotes] = useState('');
  const [selectedGenerationId, setSelectedGenerationId] = useState<string | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [customTitle, setCustomTitle] = useState('');
  const [customDescription, setCustomDescription] = useState('');
  const [customOwner, setCustomOwner] = useState('');
  const [customDueDate, setCustomDueDate] = useState('');
  const [customKind, setCustomKind] = useState<'dd' | 'cp'>('dd');

  const deal = dealQuery.data;
  const mutable = deal?.pipeline_status === 'closing';
  const generations = useMemo(
    () => generationsQuery.data ?? [],
    [generationsQuery.data],
  );
  const currentGeneration = useMemo(
    () => generations.find((generation) => generation.is_current) ?? null,
    [generations],
  );
  const selectedGeneration = useMemo(() => {
    if (selectedGenerationId) {
      return generations.find((generation) => generation.id === selectedGenerationId) ?? null;
    }
    return currentGeneration;
  }, [selectedGenerationId, generations, currentGeneration]);

  // Id set but missing from the list (stale cross-deal or mid-cache) is not "current".
  const viewingCurrent = selectedGeneration
    ? selectedGeneration.is_current
    : !selectedGenerationId;
  const itemsEditable = Boolean(mutable && viewingCurrent);

  const allDdItems = useMemo(() => ddQuery.data ?? [], [ddQuery.data]);
  const allCpItems = useMemo(() => cpQuery.data ?? [], [cpQuery.data]);
  const ddItems = useMemo(
    () =>
      selectedGeneration
        ? allDdItems.filter((item) => item.generation === selectedGeneration.id)
        : [],
    [allDdItems, selectedGeneration],
  );
  const cpItems = useMemo(
    () =>
      selectedGeneration
        ? allCpItems.filter((item) => item.generation === selectedGeneration.id)
        : [],
    [allCpItems, selectedGeneration],
  );

  const templates = templatesQuery.data ?? [];
  const assignees = assigneesQuery.data ?? [];
  const readyDocuments = (documentsQuery.data ?? []).filter((doc) => doc.storage_status === 'ready');

  const ddClearedCount = useMemo(() => {
    if (!currentGeneration) return 0;
    return allDdItems.filter(
      (item) => item.generation === currentGeneration.id && ddCleared(item),
    ).length;
  }, [allDdItems, currentGeneration]);
  const cpClearedCount = useMemo(() => {
    if (!currentGeneration) return 0;
    return allCpItems.filter(
      (item) => item.generation === currentGeneration.id && cpCleared(item),
    ).length;
  }, [allCpItems, currentGeneration]);
  const currentDdCount = useMemo(() => {
    if (!currentGeneration) return 0;
    return allDdItems.filter((item) => item.generation === currentGeneration.id).length;
  }, [allDdItems, currentGeneration]);
  const currentCpCount = useMemo(() => {
    if (!currentGeneration) return 0;
    return allCpItems.filter((item) => item.generation === currentGeneration.id).length;
  }, [allCpItems, currentGeneration]);

  useEffect(() => {
    setTargetClose(closingPackage?.target_close_date ?? '');
    setActualClose(closingPackage?.actual_close_date ?? '');
    setFundsWiredDate(closingPackage?.funds_wired_date ?? '');
    setFundsWiredAmount(closingPackage?.funds_wired_amount ?? '');
    setClosingAttorney(closingPackage?.closing_attorney ?? '');
    setTitleCompany(closingPackage?.title_company ?? '');
    setPurchasePrice(closingPackage?.purchase_price ?? '');
    setAppraisedValue(closingPackage?.appraised_value ?? '');
    setFinalLoanAmount(closingPackage?.final_loan_amount ?? '');
    setClosingCosts(closingPackage?.closing_costs ?? '');
    setSourcesAndUsesNotes(closingPackage?.sources_and_uses_notes ?? '');
    setNotes(closingPackage?.notes ?? '');
  }, [closingPackage]);

  useEffect(() => {
    if (!selectedGenerationId && currentGeneration) {
      setSelectedGenerationId(currentGeneration.id);
    }
  }, [currentGeneration, selectedGenerationId]);

  const terminalOrDocumented = useMemo(() => {
    const terminalDD = allDdItems.filter(
      (item) =>
        currentGeneration &&
        item.generation === currentGeneration.id &&
        (ddCleared(item) || item.documents.length > 0),
    ).length;
    const terminalCP = allCpItems.filter(
      (item) =>
        currentGeneration &&
        item.generation === currentGeneration.id &&
        (cpCleared(item) || item.documents.length > 0),
    ).length;
    return terminalDD + terminalCP;
  }, [allDdItems, allCpItems, currentGeneration]);

  if (dealQuery.isLoading || packageQuery.isLoading) {
    return <Spinner label="Loading closing workspace…" />;
  }
  if (dealQuery.isError || !deal) {
    return <ErrorState title="Deal unavailable" onRetry={() => void dealQuery.refetch()} />;
  }
  if (packageQuery.isError) {
    return (
      <ErrorState title="Closing package unavailable" onRetry={() => void packageQuery.refetch()} />
    );
  }

  const showError = (error: unknown, fallback: string) => {
    setBanner(apiErrorMessage(error, fallback));
    setNotice(null);
  };

  const packagePayload = () => ({
    target_close_date: targetClose.trim() === '' ? null : targetClose,
    actual_close_date: actualClose.trim() === '' ? null : actualClose,
    funds_wired_date: fundsWiredDate.trim() === '' ? null : fundsWiredDate,
    funds_wired_amount: fundsWiredAmount.trim() === '' ? null : fundsWiredAmount.trim(),
    closing_attorney: closingAttorney.trim(),
    title_company: titleCompany.trim(),
    purchase_price: purchasePrice.trim() === '' ? null : purchasePrice.trim(),
    appraised_value: appraisedValue.trim() === '' ? null : appraisedValue.trim(),
    final_loan_amount: finalLoanAmount.trim() === '' ? null : finalLoanAmount.trim(),
    closing_costs: closingCosts.trim() === '' ? null : closingCosts.trim(),
    sources_and_uses_notes: sourcesAndUsesNotes.trim(),
    notes: notes.trim(),
  });

  const onSavePackage = () => {
    setBanner(null);
    const payload = packagePayload();
    if (closingPackage) {
      patchPackage.mutate(
        { packageId: closingPackage.id, payload },
        {
          onSuccess: () =>
            setNotice(
              'Package saved. Changing the target close date does not move existing item due dates.',
            ),
          onError: (error) => showError(error, 'Could not save closing package.'),
        },
      );
      return;
    }
    upsertPackage.mutate(payload, {
      onSuccess: () => setNotice('Closing package created.'),
      onError: (error) => showError(error, 'Could not create closing package.'),
    });
  };

  const onGenerate = async () => {
    if (generateInFlight.current || generateBusy) return;
    if (!templateId) {
      setBanner('Choose a template before generating.');
      return;
    }
    if (force && !forceReason.trim()) {
      setBanner('A reason is required to force supersede.');
      return;
    }
    const confirmed = force
      ? window.confirm(
          `Force supersede will leave ${terminalOrDocumented} terminal or documented item(s) on the prior generation and create a new version. Continue?`,
        )
      : currentGeneration
        ? window.confirm(
            'This creates a new checklist version and preserves the previous generation. Continue?',
          )
        : true;
    if (!confirmed) return;
    setBanner(null);

    const payload = packagePayload();
    const packageDirty = !closingPackage || Object.entries(payload).some(
      ([field, value]) => closingPackage[field as keyof typeof closingPackage] !== value,
    );

    generateInFlight.current = true;
    setGenerateBusy(true);
    try {
      if (packageDirty) {
        if (closingPackage) {
          await patchPackage.mutateAsync({ packageId: closingPackage.id, payload });
        } else {
          await upsertPackage.mutateAsync(payload);
        }
      }

      const generation = await generate.mutateAsync({
        template_id: templateId,
        force: force && isStaff,
        force_reason: force && isStaff ? forceReason : '',
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['closing-package', dealId] }),
        queryClient.invalidateQueries({ queryKey: ['closing-generations', dealId] }),
        queryClient.invalidateQueries({ queryKey: ['dd-items', dealId] }),
        queryClient.invalidateQueries({ queryKey: ['cp-items', dealId] }),
      ]);
      setSelectedGenerationId(generation.id);
      setNotice(`Checklist v${generation.version} is current.`);
      setForce(false);
      setForceReason('');
    } catch (error) {
      showError(error, 'Could not generate checklist.');
    } finally {
      generateInFlight.current = false;
      setGenerateBusy(false);
    }
  };

  const onAddCustom = () => {
    if (!customTitle.trim()) {
      setBanner('Enter a title for the custom item.');
      return;
    }
    const mutation = customKind === 'dd' ? createDD : createCP;
    const ownerValue = customOwner.trim() === '' ? null : Number(customOwner);
    mutation.mutate(
      {
        title: customTitle.trim(),
        description: customDescription.trim(),
        owner: Number.isFinite(ownerValue as number) ? ownerValue : null,
        due_date: customDueDate.trim() === '' ? null : customDueDate,
      },
      {
        onSuccess: () => {
          setCustomTitle('');
          setCustomDescription('');
          setCustomOwner('');
          setCustomDueDate('');
          setNotice(`Added custom ${customKind === 'dd' ? 'DD' : 'CP'} item.`);
        },
        onError: (error) => showError(error, 'Could not add custom item.'),
      },
    );
  };

  const onSetDocuments = (
    kind: 'dd' | 'cp',
    item: DDChecklistItem | ConditionPrecedent,
    documentIds: string[],
  ) => {
    const mutation = kind === 'dd' ? setDDDocs : setCPDocs;
    mutation.mutate(
      { itemId: item.id, documentIds },
      {
        onSuccess: () => setNotice('Evidence documents updated.'),
        onError: (error) => showError(error, 'Could not update evidence documents.'),
      },
    );
  };

  const ownerOptions = [
    { value: '', label: 'Unassigned' },
    ...assignees.map((assignee) => ({
      value: String(assignee.id),
      label: assignee.username,
    })),
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            to={`/deals/${dealId}`}
            className="mb-3 inline-flex items-center gap-1.5 text-sm text-[var(--slate)] hover:text-[var(--ink)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Back to deal
          </Link>
          <h1 className="font-display text-3xl font-medium tracking-tight text-[var(--ink)]">
            Closing · {deal.name}
          </h1>
          <p className="mt-1 text-sm text-[var(--slate)]">
            Track due diligence, conditions precedent, final economics, and funding before Closed.
          </p>
        </div>
      </div>

      <div
        role="status"
        className="rounded-md border border-[var(--border)] bg-[var(--paper-elevated)] px-4 py-3 text-sm text-[var(--ink-muted)]"
      >
        Closing → Closed requires the current DD/CP checklist to be cleared and the final funding
        details below to be recorded. Staff can still document an explicit readiness override.
      </div>

      {!mutable ? (
        <div className="rounded-md border border-[var(--brass)]/30 bg-[var(--brass)]/8 px-4 py-3 text-sm text-[var(--ink)]">
          This deal is in <span className="font-medium">{deal.pipeline_status}</span>. Closing
          history is read-only unless the deal returns to Closing.
        </div>
      ) : null}

      {banner ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          <p>{banner}</p>
        </div>
      ) : null}
      {notice ? (
        <div className="flex items-start gap-2 rounded-md border border-[var(--brass)]/30 bg-[var(--brass)]/10 px-4 py-3 text-sm text-[var(--ink)]">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brass)]" strokeWidth={1.75} />
          <p>{notice}</p>
        </div>
      ) : null}

      <Panel title="Package">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Target close date" htmlFor="target-close">
            <Input
              id="target-close"
              type="date"
              disabled={!mutable}
              value={targetClose}
              onChange={(event) => setTargetClose(event.target.value)}
            />
          </FormField>
          <FormField label="Actual close date" htmlFor="actual-close" hint="Required for Closed">
            <Input id="actual-close" type="date" disabled={!mutable} value={actualClose} onChange={(event) => setActualClose(event.target.value)} />
          </FormField>
          <FormField label="Funds wired date" htmlFor="funds-wired-date" hint="Required for Closed">
            <Input id="funds-wired-date" type="date" disabled={!mutable} value={fundsWiredDate} onChange={(event) => setFundsWiredDate(event.target.value)} />
          </FormField>
          <FormField label="Funds wired amount" htmlFor="funds-wired-amount" hint="Required for Closed">
            <Input id="funds-wired-amount" inputMode="decimal" disabled={!mutable} value={fundsWiredAmount} onChange={(event) => setFundsWiredAmount(event.target.value)} />
          </FormField>
          <FormField label="Final loan amount" htmlFor="final-loan-amount" hint="Required for Closed">
            <Input id="final-loan-amount" inputMode="decimal" disabled={!mutable} value={finalLoanAmount} onChange={(event) => setFinalLoanAmount(event.target.value)} />
          </FormField>
          <FormField label="Closing attorney" htmlFor="closing-attorney" hint="Required for Closed">
            <Input id="closing-attorney" disabled={!mutable} value={closingAttorney} onChange={(event) => setClosingAttorney(event.target.value)} />
          </FormField>
          <FormField label="Title company" htmlFor="title-company" hint="Required for Closed">
            <Input id="title-company" disabled={!mutable} value={titleCompany} onChange={(event) => setTitleCompany(event.target.value)} />
          </FormField>
          <FormField label="Purchase price" htmlFor="purchase-price" hint="Optional">
            <Input id="purchase-price" inputMode="decimal" disabled={!mutable} value={purchasePrice} onChange={(event) => setPurchasePrice(event.target.value)} />
          </FormField>
          <FormField label="Appraised value" htmlFor="appraised-value" hint="Optional">
            <Input id="appraised-value" inputMode="decimal" disabled={!mutable} value={appraisedValue} onChange={(event) => setAppraisedValue(event.target.value)} />
          </FormField>
          <FormField label="Closing costs" htmlFor="closing-costs" hint="Optional">
            <Input id="closing-costs" inputMode="decimal" disabled={!mutable} value={closingCosts} onChange={(event) => setClosingCosts(event.target.value)} />
          </FormField>
          <FormField label="Sources and uses" htmlFor="sources-and-uses" className="sm:col-span-2" hint="Final sources, uses, and material variances">
            <Textarea id="sources-and-uses" disabled={!mutable} value={sourcesAndUsesNotes} onChange={(event) => setSourcesAndUsesNotes(event.target.value)} rows={3} />
          </FormField>
          <FormField label="Notes" htmlFor="package-notes" className="sm:col-span-2">
            <Textarea
              id="package-notes"
              disabled={!mutable}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={3}
              placeholder="Closing package notes"
            />
          </FormField>
        </div>
        <p className="mt-2 text-xs text-[var(--slate)]">
          Changing the target close date does not move existing item due dates.
        </p>
        {mutable ? (
          <div className="mt-4">
            <Button
              type="button"
              variant="outline"
              onClick={onSavePackage}
              disabled={upsertPackage.isPending || patchPackage.isPending}
            >
              Save package
            </Button>
          </div>
        ) : null}
      </Panel>

      <Panel
        title={viewingCurrent ? 'Current checklist' : 'Checklist history'}
        count={selectedGeneration?.version}
      >
        {generationsQuery.isLoading || ddQuery.isLoading || cpQuery.isLoading ? (
          <Spinner label="Loading checklist…" />
        ) : generationsQuery.isError ? (
          <ErrorState
            title="Generations unavailable"
            onRetry={() => void generationsQuery.refetch()}
          />
        ) : ddQuery.isError || cpQuery.isError ? (
          <ErrorState
            title="Checklist items unavailable"
            onRetry={() => {
              void ddQuery.refetch();
              void cpQuery.refetch();
            }}
          />
        ) : (
          <>
            <p className="mb-4 text-sm text-[var(--slate)]">
              Current completeness: DD cleared {ddClearedCount}/{currentDdCount} · CP cleared{' '}
              {cpClearedCount}/{currentCpCount}
              {currentGeneration ? ` · v${currentGeneration.version}` : ''}
              {!viewingCurrent && selectedGeneration
                ? ` · viewing v${selectedGeneration.version} (read-only)`
                : ''}
            </p>

            {mutable && viewingCurrent ? (
              <div className="mb-6 space-y-3 rounded-sm border border-[var(--border)] bg-[var(--paper)] p-4">
                {templatesQuery.isLoading ? (
                  <p className="text-sm text-[var(--slate)]">Loading templates…</p>
                ) : templatesQuery.isError ? (
                  <ErrorState
                    title="Templates unavailable"
                    onRetry={() => void templatesQuery.refetch()}
                  />
                ) : (
                  <FormField label="Template" htmlFor="closing-template">
                    <SelectNative
                      id="closing-template"
                      value={templateId}
                      onChange={(event) => setTemplateId(event.target.value)}
                      options={[
                        { value: '', label: 'Select a template' },
                        ...templates.map((template) => ({
                          value: template.id,
                          label: template.name,
                        })),
                      ]}
                    />
                  </FormField>
                )}
                {isStaff && currentGeneration ? (
                  <label className="flex items-center gap-2 text-sm text-[var(--ink)]">
                    <input
                      type="checkbox"
                      checked={force}
                      onChange={(event) => setForce(event.target.checked)}
                    />
                    Staff force supersede (when work is in progress or terminal)
                  </label>
                ) : null}
                {isStaff && force ? (
                  <>
                    <p className="text-xs text-[var(--slate)]">
                      {terminalOrDocumented} terminal or documented item(s) will remain on the prior
                      generation.
                    </p>
                    <FormField label="Force reason" htmlFor="force-reason">
                      <Textarea
                        id="force-reason"
                        value={forceReason}
                        onChange={(event) => setForceReason(event.target.value)}
                        rows={2}
                      />
                    </FormField>
                  </>
                ) : null}
                <Button
                  type="button"
                  onClick={() => void onGenerate()}
                  disabled={
                    generateBusy ||
                    generate.isPending ||
                    upsertPackage.isPending ||
                    patchPackage.isPending
                  }
                >
                  {currentGeneration ? 'Regenerate / supersede' : 'Generate checklist'}
                </Button>
              </div>
            ) : null}

            {documentsQuery.isError ? (
              <div className="mb-4">
                <ErrorState
                  title="Documents unavailable"
                  onRetry={() => void documentsQuery.refetch()}
                />
              </div>
            ) : null}

            <div className="grid gap-6 lg:grid-cols-2">
              <ItemList
                title="Due diligence"
                items={ddItems}
                mutable={itemsEditable}
                kind="dd"
                readyDocuments={readyDocuments}
                documentsLoading={documentsQuery.isLoading}
                assignees={assignees}
                assigneesLoading={assigneesQuery.isLoading}
                ownerOptions={ownerOptions}
                editingItemId={editingItemId}
                onEditingItemIdChange={setEditingItemId}
                mutationsPending={
                  updateDD.isPending || deleteDD.isPending || setDDDocs.isPending
                }
                onStatus={(item, status, waiver_reason) =>
                  updateDD.mutate(
                    { itemId: item.id, payload: { status, waiver_reason } },
                    { onError: (error) => showError(error, 'Could not update DD item.') },
                  )
                }
                onSaveDetails={(item, payload) =>
                  updateDD.mutate(
                    { itemId: item.id, payload },
                    {
                      onSuccess: () => {
                        setEditingItemId(null);
                        setNotice('DD item updated.');
                      },
                      onError: (error) => showError(error, 'Could not update DD item.'),
                    },
                  )
                }
                onDelete={(item) => {
                  if (!window.confirm(`Remove “${item.title}”?`)) return;
                  deleteDD.mutate(item.id, {
                    onError: (error) => showError(error, 'Could not delete DD item.'),
                  });
                }}
                onSetDocuments={(item, documentIds) => onSetDocuments('dd', item, documentIds)}
                onDownload={(doc) => {
                  const full = readyDocuments.find((row) => row.id === doc.id);
                  if (!full) {
                    setBanner('Document is not available to download.');
                    return;
                  }
                  downloadDocument.mutate(full, {
                    onError: (error) => showError(error, `Couldn't download ${doc.document_name}.`),
                  });
                }}
              />
              <ItemList
                title="Conditions precedent"
                items={cpItems}
                mutable={itemsEditable}
                kind="cp"
                readyDocuments={readyDocuments}
                documentsLoading={documentsQuery.isLoading}
                assignees={assignees}
                assigneesLoading={assigneesQuery.isLoading}
                ownerOptions={ownerOptions}
                editingItemId={editingItemId}
                onEditingItemIdChange={setEditingItemId}
                mutationsPending={
                  updateCP.isPending || deleteCP.isPending || setCPDocs.isPending
                }
                onStatus={(item, status, waiver_reason) =>
                  updateCP.mutate(
                    { itemId: item.id, payload: { status, waiver_reason } },
                    { onError: (error) => showError(error, 'Could not update CP item.') },
                  )
                }
                onSaveDetails={(item, payload) =>
                  updateCP.mutate(
                    { itemId: item.id, payload },
                    {
                      onSuccess: () => {
                        setEditingItemId(null);
                        setNotice('CP item updated.');
                      },
                      onError: (error) => showError(error, 'Could not update CP item.'),
                    },
                  )
                }
                onDelete={(item) => {
                  if (!window.confirm(`Remove “${item.title}”?`)) return;
                  deleteCP.mutate(item.id, {
                    onError: (error) => showError(error, 'Could not delete CP item.'),
                  });
                }}
                onSetDocuments={(item, documentIds) => onSetDocuments('cp', item, documentIds)}
                onDownload={(doc) => {
                  const full = readyDocuments.find((row) => row.id === doc.id);
                  if (!full) {
                    setBanner('Document is not available to download.');
                    return;
                  }
                  downloadDocument.mutate(full, {
                    onError: (error) => showError(error, `Couldn't download ${doc.document_name}.`),
                  });
                }}
              />
            </div>

            {itemsEditable && currentGeneration ? (
              <div className="mt-6 space-y-3 border-t border-[var(--border)] pt-4">
                <p className="text-sm font-medium text-[var(--ink)]">Add custom item</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="Title" htmlFor="custom-title">
                    <Input
                      id="custom-title"
                      value={customTitle}
                      onChange={(event) => setCustomTitle(event.target.value)}
                      placeholder="Title"
                    />
                  </FormField>
                  <FormField label="Kind" htmlFor="custom-kind">
                    <SelectNative
                      id="custom-kind"
                      value={customKind}
                      onChange={(event) => setCustomKind(event.target.value as 'dd' | 'cp')}
                      options={[
                        { value: 'dd', label: 'DD' },
                        { value: 'cp', label: 'CP' },
                      ]}
                    />
                  </FormField>
                  <FormField label="Description" htmlFor="custom-description" className="sm:col-span-2">
                    <Textarea
                      id="custom-description"
                      value={customDescription}
                      onChange={(event) => setCustomDescription(event.target.value)}
                      rows={2}
                    />
                  </FormField>
                  <FormField label="Owner" htmlFor="custom-owner">
                    <SelectNative
                      id="custom-owner"
                      value={customOwner}
                      onChange={(event) => setCustomOwner(event.target.value)}
                      options={ownerOptions}
                      disabled={assigneesQuery.isLoading || !closingPackage}
                    />
                  </FormField>
                  <FormField label="Due date" htmlFor="custom-due">
                    <Input
                      id="custom-due"
                      type="date"
                      value={customDueDate}
                      onChange={(event) => setCustomDueDate(event.target.value)}
                    />
                  </FormField>
                </div>
                <Button type="button" variant="outline" onClick={onAddCustom}>
                  <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Add
                </Button>
              </div>
            ) : null}
          </>
        )}
      </Panel>

      <Panel title="Generation history" count={generations.length}>
        {generationsQuery.isLoading ? (
          <p className="text-sm text-[var(--slate)]">Loading generations…</p>
        ) : generationsQuery.isError ? (
          <ErrorState
            title="Generations unavailable"
            onRetry={() => void generationsQuery.refetch()}
          />
        ) : generations.length === 0 ? (
          <p className="text-sm text-[var(--slate)]">No generations yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {generations
              .slice()
              .sort((a, b) => b.version - a.version)
              .map((generation) => (
                <GenerationRow
                  key={generation.id}
                  generation={generation}
                  selected={selectedGeneration?.id === generation.id}
                  onSelect={() => {
                    setSelectedGenerationId(generation.id);
                    setEditingItemId(null);
                  }}
                />
              ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function GenerationRow({
  generation,
  selected,
  onSelect,
}: {
  generation: ClosingGeneration;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={
          selected
            ? 'flex w-full flex-wrap items-center justify-between gap-2 rounded-sm border border-[var(--brass)]/40 bg-[var(--brass)]/10 px-3 py-2 text-left'
            : 'flex w-full flex-wrap items-center justify-between gap-2 rounded-sm border border-[var(--border)] px-3 py-2 text-left hover:border-[var(--brass)]/30'
        }
      >
        <span>
          v{generation.version} · {generation.template_name}
          {generation.is_current ? ' · current' : ' · superseded'}
        </span>
        <span className="text-xs text-[var(--slate)]">
          {generation.is_current
            ? new Date(generation.generated_at).toLocaleString()
            : generation.supersede_reason || 'superseded'}
        </span>
      </button>
    </li>
  );
}

function ownerLabel(
  owner: number | null,
  assignees: ClosingAssignee[],
  ownerDetail?: ClosingAssignee | null,
) {
  if (ownerDetail?.username) return ownerDetail.username;
  if (owner == null) return 'Unassigned';
  return assignees.find((row) => row.id === owner)?.username ?? `User ${owner}`;
}

function statusLabel(kind: 'dd' | 'cp', status: string) {
  if (kind === 'dd') {
    if (status === 'pending') return 'Pending';
    if (status === 'in_progress') return 'In progress';
    if (status === 'complete') return 'Complete';
    if (status === 'waived') return 'Waived';
  } else {
    if (status === 'open') return 'Open';
    if (status === 'satisfied') return 'Satisfied';
    if (status === 'waived') return 'Waived';
  }
  return status;
}

function ItemList({
  title,
  items,
  mutable,
  kind,
  readyDocuments,
  documentsLoading,
  assignees,
  assigneesLoading,
  ownerOptions,
  editingItemId,
  onEditingItemIdChange,
  mutationsPending = false,
  onStatus,
  onSaveDetails,
  onDelete,
  onSetDocuments,
  onDownload,
}: {
  title: string;
  items: Array<DDChecklistItem | ConditionPrecedent>;
  mutable: boolean;
  kind: 'dd' | 'cp';
  readyDocuments: DealDocument[];
  documentsLoading: boolean;
  assignees: ClosingAssignee[];
  assigneesLoading: boolean;
  ownerOptions: Array<{ value: string; label: string }>;
  editingItemId: string | null;
  onEditingItemIdChange: (id: string | null) => void;
  mutationsPending?: boolean;
  onStatus: (
    item: DDChecklistItem | ConditionPrecedent,
    status: string,
    waiver_reason?: string,
  ) => void;
  onSaveDetails: (
    item: DDChecklistItem | ConditionPrecedent,
    payload: {
      title: string;
      description: string;
      owner: number | null;
      due_date: string | null;
    },
  ) => void;
  onDelete: (item: DDChecklistItem | ConditionPrecedent) => void;
  onSetDocuments: (item: DDChecklistItem | ConditionPrecedent, documentIds: string[]) => void;
  onDownload: (doc: ClosingDocumentSummary) => void;
}) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-medium text-[var(--ink)]">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-[var(--slate)]">No items on this generation.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const terminal =
              kind === 'dd'
                ? ddCleared(item as DDChecklistItem)
                : cpCleared(item as ConditionPrecedent);
            const canDetach = mutable && !terminal;
            const canEditDetails = mutable && !terminal;
            const isEditing = editingItemId === item.id;

            return (
              <li
                key={item.id}
                className="rounded-sm border border-[var(--border)] bg-[var(--paper-elevated)] px-3 py-2.5"
              >
                {isEditing && canEditDetails ? (
                  <ItemEditForm
                    item={item}
                    ownerOptions={ownerOptions}
                    assigneesLoading={assigneesLoading}
                    onCancel={() => onEditingItemIdChange(null)}
                    onSave={(payload) => onSaveDetails(item, payload)}
                  />
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-[var(--ink)]">{item.title}</p>
                        {item.description ? (
                          <p className="mt-0.5 text-xs text-[var(--slate)]">{item.description}</p>
                        ) : null}
                        <p className="mt-0.5 text-xs text-[var(--slate)]">
                          {statusLabel(kind, item.status)}
                          {` · ${ownerLabel(item.owner, assignees, item.owner_detail)}`}
                          {item.due_date ? ` · due ${item.due_date}` : ''}
                          {item.documents.length ? ` · ${item.documents.length} doc(s)` : ''}
                        </p>
                      </div>
                      {mutable && !terminal ? (
                        <div className="flex flex-wrap gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            aria-label={`Edit ${item.title}`}
                            onClick={() => onEditingItemIdChange(item.id)}
                          >
                            <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </Button>
                          {kind === 'dd' ? (
                            <>
                              {item.status === 'pending' ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  disabled={mutationsPending} onClick={() => onStatus(item, 'in_progress')}
                                >
                                  Start
                                </Button>
                              ) : null}
                              {item.status === 'in_progress' ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  disabled={mutationsPending} onClick={() => onStatus(item, 'pending')}
                                >
                                  Back to pending
                                </Button>
                              ) : null}
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={mutationsPending} onClick={() => onStatus(item, 'complete')}
                              >
                                Complete
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={mutationsPending}
                                onClick={() => {
                                  const reason = window.prompt('Waiver reason');
                                  if (reason) onStatus(item, 'waived', reason);
                                }}
                              >
                                Waive
                              </Button>
                              {item.status === 'pending' ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  disabled={mutationsPending}
                                  onClick={() => onDelete(item)}
                                >
                                  Remove
                                </Button>
                              ) : null}
                            </>
                          ) : (
                            <>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={mutationsPending} onClick={() => onStatus(item, 'satisfied')}
                              >
                                Satisfy
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={mutationsPending}
                                onClick={() => {
                                  const reason = window.prompt('Waiver reason');
                                  if (reason) onStatus(item, 'waived', reason);
                                }}
                              >
                                Waive
                              </Button>
                              {item.status === 'open' ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  disabled={mutationsPending}
                                  onClick={() => onDelete(item)}
                                >
                                  Remove
                                </Button>
                              ) : null}
                            </>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </>
                )}
                {item.documents.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {item.documents.map((doc) => (
                      <li
                        key={doc.id}
                        className="flex items-center justify-between gap-2 text-xs text-[var(--slate)]"
                      >
                        <span>
                          {doc.document_name} · {doc.category} · {doc.storage_status}
                        </span>
                        <span className="flex shrink-0 gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            aria-label={`Download ${doc.document_name}`}
                            onClick={() => onDownload(doc)}
                          >
                            <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </Button>
                          {canDetach ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              aria-label={`Detach ${doc.document_name}`}
                              onClick={() =>
                                onSetDocuments(
                                  item,
                                  item.documents
                                    .filter((row) => row.id !== doc.id)
                                    .map((row) => row.id),
                                )
                              }
                            >
                              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                            </Button>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {mutable ? (
                  <div className="mt-2">
                    <SelectNative
                      aria-label={`Attach document to ${item.title}`}
                      value=""
                      disabled={documentsLoading}
                      onChange={(event) => {
                        const nextId = event.target.value;
                        if (!nextId) return;
                        const ids = [...new Set([...item.documents.map((doc) => doc.id), nextId])];
                        onSetDocuments(item, ids);
                      }}
                      options={[
                        {
                          value: '',
                          label: documentsLoading
                            ? 'Loading documents…'
                            : 'Attach ready document…',
                        },
                        ...readyDocuments
                          .filter((doc) => !item.documents.some((linked) => linked.id === doc.id))
                          .map((doc) => ({
                            value: doc.id,
                            label: doc.document_name,
                          })),
                      ]}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ItemEditForm({
  item,
  ownerOptions,
  assigneesLoading,
  onCancel,
  onSave,
}: {
  item: DDChecklistItem | ConditionPrecedent;
  ownerOptions: Array<{ value: string; label: string }>;
  assigneesLoading: boolean;
  onCancel: () => void;
  onSave: (payload: {
    title: string;
    description: string;
    owner: number | null;
    due_date: string | null;
  }) => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [owner, setOwner] = useState(item.owner != null ? String(item.owner) : '');
  const [dueDate, setDueDate] = useState(item.due_date ?? '');

  return (
    <div className="space-y-3">
      <FormField label="Title" htmlFor={`edit-title-${item.id}`}>
        <Input
          id={`edit-title-${item.id}`}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </FormField>
      <FormField label="Description" htmlFor={`edit-description-${item.id}`}>
        <Textarea
          id={`edit-description-${item.id}`}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={2}
        />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Owner" htmlFor={`edit-owner-${item.id}`}>
          <SelectNative
            id={`edit-owner-${item.id}`}
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
            options={ownerOptions}
            disabled={assigneesLoading}
          />
        </FormField>
        <FormField label="Due date" htmlFor={`edit-due-${item.id}`}>
          <Input
            id={`edit-due-${item.id}`}
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
        </FormField>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => {
            if (!title.trim()) return;
            const ownerValue = owner.trim() === '' ? null : Number(owner);
            onSave({
              title: title.trim(),
              description: description.trim(),
              owner: Number.isFinite(ownerValue as number) ? ownerValue : null,
              due_date: dueDate.trim() === '' ? null : dueDate,
            });
          }}
        >
          Save details
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
