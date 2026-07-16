import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Download,
  FilePlus2,
  Paperclip,
  Trash2,
} from 'lucide-react';

import { DebtTermsFields } from '@/components/deals/quote/DebtTermsFields';
import { QuoteActions } from '@/components/deals/quote/QuoteActions';
import { QuoteDocumentUploader } from '@/components/deals/quote/QuoteDocumentUploader';
import { QuoteHistory } from '@/components/deals/quote/QuoteHistory';
import { ErrorState, Spinner } from '@/components/deals/States';
import { Panel } from '@/components/deals/Panel';
import { Button } from '@/components/ui/button';
import { useDeal, useDealDocuments } from '@/lib/api/deals';
import { useDownloadDocument } from '@/lib/api/documents';
import {
  currentQuote,
  useCounterQuote,
  useCreateQuote,
  useExpireQuote,
  useExecuteQuote,
  useQuotes,
  useSendQuote,
  useSetQuoteAttachments,
  useUpdateQuote,
  useWithdrawQuote,
} from '@/lib/api/quotes';
import { apiErrorMessage } from '@/lib/apiError';
import { expiryTimestamp, localCalendarDate } from '@/lib/quoteExpiry';
import type { DealDocument } from '@/types/deal';
import type {
  Quote,
  QuoteFormValues,
  QuoteRateType,
  QuoteAmortizationType,
  QuoteRecourseType,
  UpdateQuotePayload,
} from '@/types/quote';
import { ATTACHMENT_EDITABLE_STATUSES, QUOTE_STATUS_LABELS } from '@/types/quote';

function emptyForm(): QuoteFormValues {
  return {
    notes: '',
    loan_amount: '',
    rate_type: '',
    interest_rate: '',
    index_name: '',
    spread: '',
    rate_floor: '',
    term_months: '',
    amortization_type: '',
    amortization_months: '',
    origination_fee_pct: '',
    exit_fee_pct: '',
    extension_terms: '',
    prepayment_terms: '',
    recourse_type: '',
    recourse_carveouts: '',
    interest_reserve_months: '',
    interest_reserve_amount: '',
    holdback_amount: '',
    good_faith_deposit: '',
    min_dscr: '',
    max_ltv: '',
    min_debt_yield: '',
    expires_on: '',
    equity_commitment: '',
    ownership_pct: '',
    preferred_return_pct: '',
    equity_summary: '',
  };
}

function quoteToForm(quote: Quote | undefined): QuoteFormValues {
  if (!quote) return emptyForm();
  return {
    notes: quote.notes,
    loan_amount: quote.loan_amount ?? '',
    rate_type: quote.rate_type,
    interest_rate: quote.interest_rate ?? '',
    index_name: quote.index_name,
    spread: quote.spread ?? '',
    rate_floor: quote.rate_floor ?? '',
    term_months: quote.term_months != null ? String(quote.term_months) : '',
    amortization_type: quote.amortization_type,
    amortization_months:
      quote.amortization_months != null ? String(quote.amortization_months) : '',
    origination_fee_pct: quote.origination_fee_pct ?? '',
    exit_fee_pct: quote.exit_fee_pct ?? '',
    extension_terms: extensionSummary(quote.extension_options),
    prepayment_terms: quote.prepayment_terms,
    recourse_type: quote.recourse_type,
    recourse_carveouts: quote.recourse_carveouts,
    interest_reserve_months:
      quote.interest_reserve_months != null ? String(quote.interest_reserve_months) : '',
    interest_reserve_amount: quote.interest_reserve_amount ?? '',
    holdback_amount: quote.holdback_amount ?? '',
    good_faith_deposit: quote.good_faith_deposit ?? '',
    min_dscr: quote.min_dscr ?? '',
    max_ltv: quote.max_ltv ?? '',
    min_debt_yield: quote.min_debt_yield ?? '',
    expires_on: localCalendarDate(quote.expires_at),
    equity_commitment: quote.equity_commitment ?? '',
    ownership_pct: quote.ownership_pct ?? '',
    preferred_return_pct: quote.preferred_return_pct ?? '',
    equity_summary: quote.equity_summary,
  };
}

function nullableDecimal(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function nullableInt(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function extensionSummary(options: unknown[]): string {
  if (!options.length) return '';
  if (options.length === 1 && typeof options[0] === 'object' && options[0] !== null) {
    const summary = (options[0] as { summary?: unknown }).summary;
    if (typeof summary === 'string') return summary;
  }
  return JSON.stringify(options);
}

function formToPayload(values: QuoteFormValues): UpdateQuotePayload {
  return {
    notes: values.notes,
    loan_amount: nullableDecimal(values.loan_amount),
    rate_type: values.rate_type as QuoteRateType,
    interest_rate: nullableDecimal(values.interest_rate),
    index_name: values.index_name,
    spread: nullableDecimal(values.spread),
    rate_floor: nullableDecimal(values.rate_floor),
    term_months: nullableInt(values.term_months),
    amortization_type: values.amortization_type as QuoteAmortizationType,
    amortization_months: nullableInt(values.amortization_months),
    origination_fee_pct: nullableDecimal(values.origination_fee_pct),
    exit_fee_pct: nullableDecimal(values.exit_fee_pct),
    extension_options: values.extension_terms.trim()
      ? [{ summary: values.extension_terms.trim() }]
      : [],
    prepayment_terms: values.prepayment_terms,
    recourse_type: values.recourse_type as QuoteRecourseType,
    recourse_carveouts: values.recourse_carveouts,
    interest_reserve_months: nullableInt(values.interest_reserve_months),
    interest_reserve_amount: nullableDecimal(values.interest_reserve_amount),
    holdback_amount: nullableDecimal(values.holdback_amount),
    good_faith_deposit: nullableDecimal(values.good_faith_deposit),
    min_dscr: nullableDecimal(values.min_dscr),
    max_ltv: nullableDecimal(values.max_ltv),
    min_debt_yield: nullableDecimal(values.min_debt_yield),
    expires_at: expiryTimestamp(values.expires_on),
  };
}

export default function DealQuotePage({ dealId: dealIdProp }: { dealId?: string }) {
  const { id: routeDealId } = useParams<{ id: string }>();
  const dealId = dealIdProp ?? routeDealId;

  if (!dealId) {
    return (
      <ErrorState
        title="Deal is required"
        message="Open quotes from a specific deal so the term sheet can be attached correctly."
      />
    );
  }

  return <DealQuoteWorkspace key={dealId} dealId={dealId} />;
}

export function DealQuoteWorkspace({ dealId }: { dealId: string }) {
  const dealQuery = useDeal(dealId);
  const quotesQuery = useQuotes(dealId);

  if (dealQuery.isLoading || quotesQuery.isLoading) {
    return <Spinner label="Loading quote workspace…" />;
  }

  if (dealQuery.isError || !dealQuery.data) {
    return (
      <div className="space-y-6">
        <BackLink dealId={dealId} />
        <ErrorState title="Deal unavailable" onRetry={() => void dealQuery.refetch()} />
      </div>
    );
  }

  if (quotesQuery.isError) {
    return (
      <div className="space-y-6">
        <BackLink dealId={dealId} />
        <ErrorState
          title="Quote workspace unavailable"
          message="The quote history could not be loaded. Try again in a moment."
          onRetry={() => void quotesQuery.refetch()}
        />
      </div>
    );
  }

  return (
    <QuoteWorkspaceContent
      dealId={dealId}
      dealName={dealQuery.data.name}
      pipelineStatus={dealQuery.data.pipeline_status}
      quotes={quotesQuery.data ?? []}
    />
  );
}

function QuoteWorkspaceContent({
  dealId,
  dealName,
  pipelineStatus,
  quotes,
}: {
  dealId: string;
  dealName: string;
  pipelineStatus: string;
  quotes: Quote[];
}) {
  const current = useMemo(() => currentQuote(quotes), [quotes]);
  const [values, setValues] = useState<QuoteFormValues>(() => quoteToForm(current));
  const [baseline, setBaseline] = useState(() => JSON.stringify(quoteToForm(current)));
  const [banner, setBanner] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploaderOpen, setUploaderOpen] = useState(false);

  const documentsQuery = useDealDocuments(dealId);
  const downloadDocument = useDownloadDocument();
  const setAttachments = useSetQuoteAttachments(dealId);
  const createQuoteMutation = useCreateQuote(dealId);
  const updateQuote = useUpdateQuote(current?.id ?? '', dealId);
  const sendQuote = useSendQuote(dealId);
  const counterQuote = useCounterQuote(dealId);
  const executeQuote = useExecuteQuote(dealId);
  const withdrawQuote = useWithdrawQuote(dealId);
  const expireQuote = useExpireQuote(dealId);

  const documentsById = useMemo(() => {
    const map = new Map<string, DealDocument>();
    for (const doc of documentsQuery.data ?? []) {
      map.set(doc.id, doc);
    }
    return map;
  }, [documentsQuery.data]);

  const canCreateQuotes =
    pipelineStatus === 'quoting' || pipelineStatus === 'negotiating';
  const editable = current?.status === 'draft' && current.is_current;
  const canAttach =
    Boolean(current?.is_current) &&
    current !== undefined &&
    ATTACHMENT_EDITABLE_STATUSES.includes(current.status);
  const dirty = JSON.stringify(values) !== baseline;
  const busy =
    createQuoteMutation.isPending ||
    updateQuote.isPending ||
    sendQuote.isPending ||
    counterQuote.isPending ||
    executeQuote.isPending ||
    withdrawQuote.isPending ||
    expireQuote.isPending ||
    setAttachments.isPending ||
    downloadDocument.isPending;

  const showError = (error: unknown, fallback: string) => {
    setBanner(apiErrorMessage(error, fallback));
  };

  const onRemoveAttachment = (documentId: string) => {
    if (!current || !canAttach) return;
    setBanner(null);
    setNotice(null);
    const nextIds = current.attachments.filter((id) => id !== documentId);
    setAttachments.mutate(
      { quoteId: current.id, payload: { document_ids: nextIds } },
      {
        onSuccess: () => setNotice('Attachment removed from this quote.'),
        onError: (error) => showError(error, 'Could not remove the attachment.'),
      },
    );
  };

  useEffect(() => {
    const next = quoteToForm(current);
    setValues(next);
    setBaseline(JSON.stringify(next));
  }, [current]);

  const setField = (field: keyof QuoteFormValues, value: string) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  const onSave = () => {
    if (!current || !editable) return;
    setBanner(null);
    setNotice(null);
    updateQuote.mutate(formToPayload(values), {
      onSuccess: (quote) => {
        const next = quoteToForm(quote);
        setValues(next);
        setBaseline(JSON.stringify(next));
        setNotice(`Draft v${quote.version} saved.`);
      },
      onError: (error) => showError(error, 'Could not save the quote.'),
    });
  };

  const onSend = () => {
    if (!current) return;
    setBanner(null);
    setNotice(null);
    sendQuote.mutate(
      { quoteId: current.id },
      {
        onSuccess: (quote) => setNotice(`v${quote.version} sent.`),
        onError: (error) => showError(error, 'Could not send the quote.'),
      },
    );
  };

  const onCounter = () => {
    if (!current) return;
    setBanner(null);
    setNotice(null);
    counterQuote.mutate(current.id, {
      onSuccess: (quote) => setNotice(`Counter draft v${quote.version} created.`),
      onError: (error) => showError(error, 'Could not create a counter.'),
    });
  };

  const onExecute = () => {
    if (!current) return;
    const attachedNames = current.attachments
      .map((id) => documentsById.get(id)?.document_name)
      .filter(Boolean);
    const evidenceLabel =
      attachedNames.length > 0
        ? attachedNames.join(', ')
        : 'the attached legal term sheet/LOI';
    const confirmed = window.confirm(
      `Execute quote v${current.version} using ${evidenceLabel}? This locks the attachment as execution evidence.`,
    );
    if (!confirmed) return;
    setBanner(null);
    setNotice(null);
    executeQuote.mutate(current.id, {
      onSuccess: (quote) => setNotice(`v${quote.version} executed.`),
      onError: (error) => showError(error, 'Could not execute the quote.'),
    });
  };

  const onWithdraw = () => {
    if (!current) return;
    setBanner(null);
    setNotice(null);
    withdrawQuote.mutate(current.id, {
      onSuccess: (quote) => setNotice(`v${quote.version} withdrawn.`),
      onError: (error) => showError(error, 'Could not withdraw the quote.'),
    });
  };

  const onExpire = () => {
    if (!current) return;
    setBanner(null);
    setNotice(null);
    expireQuote.mutate(current.id, {
      onSuccess: (quote) => setNotice(`v${quote.version} expired.`),
      onError: (error) => showError(error, 'Could not expire the quote.'),
    });
  };

  const onCreateNextVersion = () => {
    if (!canCreateQuotes) return;
    setBanner(null);
    setNotice(null);
    createQuoteMutation.mutate(
      { deal: dealId, seed_from_screening: true },
      {
        onSuccess: (quote) => setNotice(`Draft v${quote.version} created.`),
        onError: (error) => showError(error, 'Could not create a new quote version.'),
      },
    );
  };

  const onCreateFirstQuote = () => {
    if (!canCreateQuotes || current) return;
    setBanner(null);
    setNotice(null);
    createQuoteMutation.mutate(
      { deal: dealId, seed_from_screening: true },
      {
        onSuccess: (quote) => setNotice(`Draft v${quote.version} created from screening.`),
        onError: (error) => showError(error, 'Could not create the first quote.'),
      },
    );
  };

  if (!canCreateQuotes && quotes.length === 0) {
    return (
      <div className="space-y-6">
        <BackLink dealId={dealId} />
        <ErrorState
          title="Quotes unavailable"
          message="Quotes can only be created while the deal is in Quoting or Negotiating."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="animate-fade-up space-y-3 border-b border-[var(--border)] pb-6">
        <BackLink dealId={dealId} />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--slate)]">
              Quote / term sheet
            </p>
            <h1 className="font-display mt-2 text-3xl font-medium tracking-tight text-[var(--ink)]">
              {dealName}
            </h1>
            <p className="mt-2 max-w-2xl text-[var(--slate)]">
              Capture debt terms, attach a legal term sheet, then send and execute the current
              version.
            </p>
          </div>
          {current ? (
            <div className="rounded-sm border border-[var(--border)] bg-[var(--paper-elevated)] px-3 py-2 text-sm">
              <p className="font-medium text-[var(--ink)]">v{current.version}</p>
              <p className="text-xs text-[var(--slate)]">{QUOTE_STATUS_LABELS[current.status]}</p>
            </div>
          ) : null}
        </div>
      </header>

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
        <div
          aria-live="polite"
          className="flex items-start gap-2 rounded-md border border-[var(--brass)]/30 bg-[var(--brass)]/10 px-4 py-3 text-sm text-[var(--ink)]"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brass)]" strokeWidth={1.75} />
          <p>{notice}</p>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="animate-fade-up stagger-1 space-y-6">
          <Panel title="Debt terms">
            {!editable && current ? (
              <p className="mb-4 rounded-sm border border-[var(--brass)]/25 bg-[var(--brass)]/8 px-3 py-2 text-sm text-[var(--ink-muted)]">
                {current.status === 'sent' || current.status === 'countered'
                  ? 'Non-draft quotes are read-only. Use Counter to open a new draft version.'
                  : 'Non-draft quotes are read-only. Start a new version after this one is terminal.'}
              </p>
            ) : null}
            <DebtTermsFields
              values={values}
              onChange={setField}
              disabled={!editable || busy}
              originationFeeAmount={current?.origination_fee_amount}
              initialFundingAmount={current?.initial_funding_amount}
            />
          </Panel>

          <Panel
            title="Attachments"
            count={current?.attachments.length}
            action={
              canAttach ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setUploaderOpen(true)}>
                  <FilePlus2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Attach
                </Button>
              ) : null
            }
          >
            {current && current.attachments.length > 0 ? (
              <ul className="space-y-2">
                {current.attachments.map((documentId) => {
                  const doc = documentsById.get(documentId);
                  const subcategoryLabel =
                    doc?.subcategory === 'loi'
                      ? 'LOI'
                      : doc?.subcategory === 'term_sheet'
                        ? 'Term sheet'
                        : null;
                  return (
                    <li
                      key={documentId}
                      className="flex items-start justify-between gap-3 rounded-sm border border-[var(--border)] bg-[var(--paper-elevated)] px-3 py-2.5"
                    >
                      <div className="min-w-0 flex items-start gap-2">
                        <Paperclip className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--slate)]" strokeWidth={1.75} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-[var(--ink)]">
                            {doc?.document_name ??
                              (documentsQuery.isError
                                ? 'Could not load document'
                                : 'Document unavailable')}
                          </p>
                          <p className="mt-0.5 text-xs text-[var(--slate)]">
                            {[subcategoryLabel, doc?.storage_status ?? 'unknown']
                              .filter(Boolean)
                              .join(' · ')}
                            {!doc && documentsQuery.isLoading ? 'Loading…' : null}
                            {!doc && documentsQuery.isError ? (
                              <button
                                type="button"
                                className="ml-1 underline"
                                onClick={() => void documentsQuery.refetch()}
                              >
                                Retry
                              </button>
                            ) : null}
                          </p>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {doc ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={downloadDocument.isPending}
                            onClick={() => {
                              downloadDocument.mutate(doc, {
                                onError: (err) =>
                                  showError(err, `Couldn't download ${doc.document_name}.`),
                              });
                            }}
                            aria-label={`Download ${doc.document_name}`}
                          >
                            <Download className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </Button>
                        ) : null}
                        {canAttach ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={setAttachments.isPending}
                            onClick={() => onRemoveAttachment(documentId)}
                            aria-label={`Remove attachment ${doc?.document_name ?? documentId}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-[var(--slate)]">
                Attach a legal term sheet or LOI before executing. You can upload a new file or
                attach an eligible document already on this deal while the quote is draft, sent, or
                countered.
              </p>
            )}
          </Panel>

          <Panel title="Actions">
            <QuoteActions
              quote={current}
              dirty={dirty}
              saving={updateQuote.isPending}
              busy={busy}
              canCreateNextVersion={canCreateQuotes}
              onSave={onSave}
              onSend={onSend}
              onCounter={onCounter}
              onExecute={onExecute}
              onWithdraw={onWithdraw}
              onExpire={onExpire}
              onCreateNextVersion={onCreateNextVersion}
              onCreateFirst={onCreateFirstQuote}
              sendReady={current?.is_send_ready ?? false}
              missingSendFields={current?.missing_send_fields ?? []}
            />
          </Panel>
        </div>

        <aside className="animate-fade-up stagger-2 space-y-6">
          <Panel title="Version history" count={quotes.length}>
            <QuoteHistory quotes={quotes} currentId={current?.id} />
          </Panel>
          <Panel title="How this works">
            <ul className="space-y-3 text-sm text-[var(--slate)]">
              <li>
                <span className="font-medium text-[var(--ink)]">Draft:</span> edit terms, attach
                docs, then send.
              </li>
              <li>
                <span className="font-medium text-[var(--ink)]">Sent / countered:</span> attach the
                executed legal form, then execute — or counter to revise.
              </li>
              <li>
                <span className="font-medium text-[var(--ink)]">Terminal:</span> after executed,
                expired, or withdrawn, use New version to continue.
              </li>
              <li>
                <span className="font-medium text-[var(--ink)]">Current only:</span> workflow actions
                always target the highest version.
              </li>
            </ul>
          </Panel>
        </aside>
      </div>

      {current && canAttach ? (
        <QuoteDocumentUploader
          dealId={dealId}
          quote={current}
          open={uploaderOpen}
          onOpenChange={setUploaderOpen}
        />
      ) : null}
    </div>
  );
}

function BackLink({ dealId }: { dealId: string }) {
  return (
    <Link
      to={`/deals/${dealId}`}
      className="inline-flex items-center gap-1.5 text-sm text-[var(--slate)] transition-colors hover:text-[var(--ink)]"
    >
      <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
      Deal detail
    </Link>
  );
}
