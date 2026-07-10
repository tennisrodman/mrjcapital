import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, FilePlus2, Save } from 'lucide-react';

import { DebtInputFields } from '@/components/deals/screening/DebtInputFields';
import { DebtMetrics } from '@/components/deals/screening/DebtMetrics';
import { DecisionFields } from '@/components/deals/screening/DecisionFields';
import { ScreeningHistory } from '@/components/deals/screening/ScreeningHistory';
import {
  assessmentMetrics,
  assessmentToFormValues,
  calculateDebtMetrics,
  screeningPayloadFromForm,
} from '@/components/deals/screening/calculations';
import { ErrorState, Spinner } from '@/components/deals/States';
import { Panel } from '@/components/deals/Panel';
import { Button } from '@/components/ui/button';
import { useDeal } from '@/lib/api/deals';
import {
  currentScreeningAssessment,
  useCreateScreeningAssessment,
  useFinalizeScreeningAssessment,
  useScreeningAssessments,
  useUpdateScreeningAssessment,
} from '@/lib/api/screening';
import { apiErrorMessage, fieldErrors } from '@/lib/apiError';
import type {
  CreateScreeningAssessmentPayload,
  ScreeningAssessment,
  ScreeningAssessmentFormValues,
  UpdateScreeningAssessmentPayload,
} from '@/types/screening';

const SERVER_FIELD_TO_FORM: Record<string, keyof ScreeningAssessmentFormValues> = {
  loan_amount: 'loan_amount',
  as_is_value: 'as_is_value',
  stabilized_value: 'stabilized_value',
  project_cost: 'project_cost',
  noi: 'noi',
  annual_debt_service: 'annual_debt_service',
  occupancy: 'occupancy',
  proposed_rate: 'proposed_rate',
  proposed_term_months: 'proposed_term_months',
  equity_summary: 'equity_summary',
  equity_target_irr: 'equity_target_irr',
  equity_target_multiple: 'equity_target_multiple',
  equity_target_hold_months: 'equity_target_hold_months',
  decision: 'decision',
  notes: 'notes',
};

function valuesFor(
  assessment: ScreeningAssessment | undefined,
  defaultLoanAmount: string,
): ScreeningAssessmentFormValues {
  return assessmentToFormValues(assessment, defaultLoanAmount);
}

function createPayload(
  values: ScreeningAssessmentFormValues,
  dealId: string,
): CreateScreeningAssessmentPayload {
  return screeningPayloadFromForm(values, dealId);
}

function updatePayload(values: ScreeningAssessmentFormValues): UpdateScreeningAssessmentPayload {
  const payload = createPayload(values, '');
  return {
    loan_amount: payload.loan_amount,
    as_is_value: payload.as_is_value,
    stabilized_value: payload.stabilized_value,
    project_cost: payload.project_cost,
    noi: payload.noi,
    annual_debt_service: payload.annual_debt_service,
    occupancy: payload.occupancy,
    proposed_rate: payload.proposed_rate,
    proposed_term_months: payload.proposed_term_months,
    equity_summary: payload.equity_summary,
    equity_target_irr: payload.equity_target_irr,
    equity_target_multiple: payload.equity_target_multiple,
    equity_target_hold_months: payload.equity_target_hold_months,
    decision: payload.decision,
    notes: payload.notes,
  };
}

export default function DealScreeningPage({ dealId: dealIdProp }: { dealId?: string }) {
  const { id: routeDealId } = useParams<{ id: string }>();
  const dealId = dealIdProp ?? routeDealId;

  if (!dealId) {
    return (
      <ErrorState
        title="Deal is required"
        message="Open screening from a specific deal so the assessment can be attached correctly."
      />
    );
  }

  return <DealScreeningWorkspace dealId={dealId} />;
}

/** Exported separately so the deal detail surface can embed the workspace later. */
export function DealScreeningWorkspace({ dealId }: { dealId: string }) {
  const dealQuery = useDeal(dealId);
  const assessmentsQuery = useScreeningAssessments(dealId);

  if (dealQuery.isLoading || assessmentsQuery.isLoading) {
    return <Spinner label="Loading debt screening…" />;
  }

  if (dealQuery.isError || !dealQuery.data) {
    return (
      <div className="space-y-6">
        <BackLink dealId={dealId} />
        <ErrorState title="Deal unavailable" onRetry={() => void dealQuery.refetch()} />
      </div>
    );
  }

  if (assessmentsQuery.isError) {
    return (
      <div className="space-y-6">
        <BackLink dealId={dealId} />
        <ErrorState
          title="Screening workspace unavailable"
          message="The assessment history could not be loaded. Try again in a moment."
          onRetry={() => void assessmentsQuery.refetch()}
        />
      </div>
    );
  }

  return <ScreeningWorkspaceContent dealId={dealId} dealName={dealQuery.data.name} requestedAmount={dealQuery.data.requested_amount} assessments={assessmentsQuery.data ?? []} />;
}

function ScreeningWorkspaceContent({
  dealId,
  dealName,
  requestedAmount,
  assessments,
}: {
  dealId: string;
  dealName: string;
  requestedAmount: string;
  assessments: ScreeningAssessment[];
}) {
  const current = useMemo(() => currentScreeningAssessment(assessments), [assessments]);
  const [creatingRevision, setCreatingRevision] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const form = useForm<ScreeningAssessmentFormValues>({
    defaultValues: valuesFor(current, requestedAmount),
  });
  const { register, handleSubmit, reset, setError, watch, formState } = form;
  const errors = formState.errors;

  const createAssessment = useCreateScreeningAssessment(dealId);
  const updateAssessment = useUpdateScreeningAssessment(current?.id ?? '', dealId);
  const finalizeAssessment = useFinalizeScreeningAssessment(current?.id ?? '', dealId);

  useEffect(() => {
    reset(valuesFor(current, requestedAmount));
    if (current?.status === 'draft') setCreatingRevision(false);
  }, [current, requestedAmount, reset]);

  const values = watch();
  const draftPayload = useMemo(() => screeningPayloadFromForm(values, dealId), [dealId, values]);
  const calculatedMetrics = useMemo(() => calculateDebtMetrics(draftPayload), [draftPayload]);
  const lockedFinal = current?.status === 'finalized' && !creatingRevision;
  const metrics = lockedFinal && current ? assessmentMetrics(current) : calculatedMetrics;
  const isSaving = createAssessment.isPending || updateAssessment.isPending;
  const creatingNew = !current || creatingRevision;

  const showApiError = (error: unknown) => {
    const serverErrors = fieldErrors(error);
    let mapped = false;
    for (const [serverField, message] of Object.entries(serverErrors)) {
      const formField = SERVER_FIELD_TO_FORM[serverField];
      if (formField) {
        setError(formField, { message });
        mapped = true;
      }
    }
    setBanner(mapped ? 'Please fix the highlighted fields.' : apiErrorMessage(error));
  };

  const onSubmit = (values: ScreeningAssessmentFormValues) => {
    setBanner(null);
    setNotice(null);
    if (creatingNew) {
      createAssessment.mutate(createPayload(values, dealId), {
        onSuccess: (assessment) => {
          setCreatingRevision(false);
          reset(valuesFor(assessment, requestedAmount));
          setNotice(`Draft v${assessment.version} saved.`);
        },
        onError: showApiError,
      });
      return;
    }
    if (!current) return;
    updateAssessment.mutate(updatePayload(values), {
      onSuccess: (assessment) => {
        reset(valuesFor(assessment, requestedAmount));
        setNotice(`Draft v${assessment.version} saved.`);
      },
      onError: showApiError,
    });
  };

  const startRevision = () => {
    if (!current) return;
    setCreatingRevision(true);
    setBanner(null);
    setNotice('New draft started from the finalized assessment.');
    reset(valuesFor(current, requestedAmount));
  };

  const finalize = () => {
    if (!current || current.status === 'finalized' || formState.isDirty) return;
    if (!current.decision) {
      setError('decision', { message: 'Choose advance, refer, or decline before finalizing.' });
      setBanner('A final screening decision is required.');
      return;
    }
    setBanner(null);
    setNotice(null);
    finalizeAssessment.mutate({ decision: current.decision, notes: current.notes }, {
      onSuccess: (assessment) => {
        reset(valuesFor(assessment, requestedAmount));
        setNotice(`v${assessment.version} finalized. Start a new draft to revise it.`);
      },
      onError: (error) => setBanner(apiErrorMessage(error, 'Could not finalize the assessment.')),
    });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <header className="animate-fade-up space-y-3 border-b border-[var(--border)] pb-6">
        <BackLink dealId={dealId} />
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--slate)]">Debt-first screening</p>
            <h1 className="font-display mt-2 text-3xl font-medium tracking-tight text-[var(--ink)]">{dealName}</h1>
            <p className="mt-2 max-w-2xl text-[var(--slate)]">
              Establish leverage, coverage, and a concise credit posture before deeper underwriting.
            </p>
          </div>
          {current ? (
            <div className="rounded-sm border border-[var(--border)] bg-[var(--paper-elevated)] px-3 py-2 text-sm">
              <p className="font-medium text-[var(--ink)]">v{current.version}</p>
              <p className="text-xs text-[var(--slate)]">{current.status === 'finalized' ? 'Finalized' : 'Draft'}</p>
            </div>
          ) : null}
        </div>
      </header>

      {banner ? (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
          <p>{banner}</p>
        </div>
      ) : null}
      {notice ? (
        <div aria-live="polite" className="flex items-start gap-2 rounded-md border border-[var(--brass)]/30 bg-[var(--brass)]/10 px-4 py-3 text-sm text-[var(--ink)]">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brass)]" strokeWidth={1.75} />
          <p>{notice}</p>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="animate-fade-up stagger-1 space-y-6">
          <Panel
            title="Debt underwriting inputs"
            action={
              lockedFinal ? (
                <Button type="button" variant="outline" size="sm" onClick={startRevision}>
                  <FilePlus2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  New draft
                </Button>
              ) : null
            }
          >
            {lockedFinal ? (
              <p className="mb-4 rounded-sm border border-[var(--brass)]/25 bg-[var(--brass)]/8 px-3 py-2 text-sm text-[var(--ink-muted)]">
                This assessment is finalized and read-only. Create a new draft to preserve the version history.
              </p>
            ) : null}
            <DebtInputFields register={register} errors={errors} disabled={lockedFinal || isSaving} />
          </Panel>

          <Panel title="Debt screen">
            <DebtMetrics metrics={metrics} />
          </Panel>

          <Panel title="Decision and context">
            <DecisionFields register={register} errors={errors} disabled={lockedFinal || isSaving} />
          </Panel>

          {!lockedFinal ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={isSaving}>
                <Save className="h-3.5 w-3.5" strokeWidth={1.75} />
                {isSaving ? 'Saving…' : creatingNew ? 'Save draft' : 'Save changes'}
              </Button>
              {current && !creatingNew ? (
                <Button
                  type="button"
                  variant="brass"
                  disabled={finalizeAssessment.isPending || formState.isDirty || !current.decision}
                  onClick={finalize}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {finalizeAssessment.isPending ? 'Finalizing…' : 'Finalize assessment'}
                </Button>
              ) : null}
              {current && !creatingNew && formState.isDirty ? (
                <p className="text-xs text-[var(--slate)]">Save changes before finalizing.</p>
              ) : null}
            </div>
          ) : null}
        </div>

        <aside className="animate-fade-up stagger-2 space-y-6">
          <Panel title="Version history" count={assessments.length}>
            <ScreeningHistory assessments={assessments} currentId={current?.id} />
          </Panel>
          <Panel title="How to read this">
            <ul className="space-y-3 text-sm text-[var(--slate)]">
              <li><span className="font-medium text-[var(--ink)]">LTV/LTC:</span> lower leverage generally improves resilience.</li>
              <li><span className="font-medium text-[var(--ink)]">DSCR:</span> annual NOI divided by annual debt service.</li>
              <li><span className="font-medium text-[var(--ink)]">Quick score:</span> a transparent triage signal, not an approval.</li>
            </ul>
          </Panel>
        </aside>
      </div>
    </form>
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
