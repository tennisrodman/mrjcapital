import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, ArrowRight, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/field';
import { SelectNative } from '@/components/ui/select-native';
import { Textarea } from '@/components/ui/textarea';
import { PIPELINE_STATUS_LABELS, SYNDICATION_STATUS_LABELS } from '@/lib/dealChoices';
import {
  useAllowedTransitions,
  useTransitionPipeline,
  useTransitionSyndication,
} from '@/lib/api/deals';
import { apiErrorMessage, fieldErrors } from '@/lib/apiError';
import type { Deal } from '@/types/deal';

type TransitionKind = 'pipeline' | 'syndication';

const READINESS_BLOCKER_LABELS: Record<string, string> = {
  screening_assessment_missing: 'Create a screening assessment before moving to Quoting.',
  screening_assessment_not_finalized: 'Finalize the current screening assessment before moving to Quoting.',
  screening_decision_not_advance: 'The current screening decision must be Advance before moving to Quoting.',
  screening_assessment_incomplete: 'Complete the required debt screening inputs before moving to Quoting.',
  quote_required_for_negotiating: 'Send or execute the current quote before moving to Negotiating.',
  quote_execution_required: 'Execute the current quote (with a ready legal term sheet or LOI) before moving to Signed.',
  quote_execution_evidence_required: 'Attach ready execution evidence to the executed quote before moving to Signed.',
  closing_package_required: 'Create the closing package before marking the deal Closed.',
  closing_funding_details_incomplete: 'Record actual close, wired funds, final loan amount, attorney, and title company.',
  closing_checklist_required: 'Generate a current closing checklist before marking the deal Closed.',
  closing_dd_incomplete: 'Complete or waive every current due-diligence item.',
  closing_cp_incomplete: 'Satisfy or waive every current condition precedent.',
};

interface TransitionDialogProps {
  deal: Deal;
  kind: TransitionKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TransitionDialog({ deal, kind, open, onOpenChange }: TransitionDialogProps) {
  const allowed = useAllowedTransitions(deal.id, open);
  const pipelineMutation = useTransitionPipeline(deal.id);
  const syndicationMutation = useTransitionSyndication(deal.id);
  const mutation = kind === 'pipeline' ? pipelineMutation : syndicationMutation;

  const [toStatus, setToStatus] = useState('');
  const [reason, setReason] = useState('');
  const [overrideReadiness, setOverrideReadiness] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setToStatus('');
      setReason('');
      setOverrideReadiness(false);
      setError(null);
    }
  }, [open]);

  const labels = kind === 'pipeline' ? PIPELINE_STATUS_LABELS : SYNDICATION_STATUS_LABELS;
  const targets = (kind === 'pipeline'
    ? allowed.data?.pipeline_status
    : allowed.data?.syndication_status) ?? [];
  const options = targets.map((value) => ({ value, label: labels[value as keyof typeof labels] }));
  const readiness = kind === 'pipeline' && toStatus
    ? allowed.data?.readiness?.[toStatus as Deal['pipeline_status']]
    : undefined;
  const readinessBlocked = Boolean(readiness && !readiness.ready);

  const currentLabel =
    kind === 'pipeline'
      ? PIPELINE_STATUS_LABELS[deal.pipeline_status]
      : SYNDICATION_STATUS_LABELS[deal.syndication_status];

  const title = kind === 'pipeline' ? 'Move pipeline stage' : 'Update syndication';

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!toStatus) {
      setError('Choose a status to move to.');
      return;
    }
    if (!reason.trim()) {
      setError('A reason is required for every status change.');
      return;
    }
    if (readinessBlocked && !overrideReadiness) {
      setError('Resolve the readiness requirements or explicitly record a staff override.');
      return;
    }
    mutation.mutate(
      {
        to_status: toStatus,
        reason: reason.trim(),
        ...(kind === 'pipeline' ? { override_readiness: overrideReadiness } : {}),
      },
      {
        onSuccess: () => onOpenChange(false),
        onError: (err) => {
          if (kind === 'pipeline') void allowed.refetch();
          const fields = fieldErrors(err);
          setError(Object.keys(fields).length ? Object.values(fields)[0] : apiErrorMessage(err));
        },
      },
    );
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--ink)]/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--paper-elevated)] p-6 shadow-2xl focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-display text-lg font-medium text-[var(--ink)]">
                {title}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-[var(--slate)]">
                Currently <span className="font-medium text-[var(--ink-muted)]">{currentLabel}</span>.
                Every change is logged with your reason.
              </Dialog.Description>
            </div>
            <Dialog.Close aria-label="Close transition dialog" className="rounded-sm p-1 text-[var(--slate)] transition-colors hover:bg-[var(--ink)]/5 hover:text-[var(--ink)]">
              <X className="h-4 w-4" strokeWidth={1.75} />
            </Dialog.Close>
          </div>

          {allowed.isLoading ? (
            <p className="mt-5 text-sm text-[var(--slate)]">Loading available moves…</p>
          ) : allowed.isError ? (
            <div
              role="alert"
              className="mt-5 rounded-sm border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-700"
            >
              <p>Available moves could not be loaded.</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                disabled={allowed.isFetching}
                onClick={() => void allowed.refetch()}
              >
                {allowed.isFetching ? 'Trying again…' : 'Try again'}
              </Button>
            </div>
          ) : options.length === 0 ? (
            <div className="mt-5 rounded-sm border border-dashed border-[var(--border)] bg-[var(--paper)] px-4 py-6 text-center text-sm text-[var(--slate)]">
              No moves are available from {currentLabel.toLowerCase()}.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <FormField label="Move to" htmlFor={`${kind}-transition-status`}>
                <SelectNative
                  id={`${kind}-transition-status`}
                  placeholder="Select a status"
                  options={options}
                  value={toStatus}
                  onChange={(event) => {
                    setToStatus(event.target.value);
                    setOverrideReadiness(false);
                    setError(null);
                  }}
                />
              </FormField>

              {readinessBlocked ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="rounded-sm border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-900"
                >
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
                    <div className="min-w-0">
                      <p className="font-medium">This stage is not ready.</p>
                      <ul className="mt-1 space-y-1 text-xs">
                        {readiness?.blockers.map((blocker) => (
                          <li key={blocker}>{READINESS_BLOCKER_LABELS[blocker] ?? blocker}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  {readiness?.can_override ? (
                    <label className="mt-3 flex cursor-pointer items-start gap-2 border-t border-amber-200 pt-3 text-xs">
                      <input
                        type="checkbox"
                        checked={overrideReadiness}
                        onChange={(event) => setOverrideReadiness(event.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-[var(--brass)]"
                      />
                      <span>Override readiness and record this exception in stage history.</span>
                    </label>
                  ) : null}
                </div>
              ) : null}

              <FormField label="Reason" htmlFor={`${kind}-transition-reason`} required>
                <Textarea
                  id={`${kind}-transition-reason`}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Why is this deal moving? This is recorded in the activity log."
                />
              </FormField>

              {error ? (
                <p role="alert" className="text-sm text-red-600">
                  {error}
                </p>
              ) : null}

              <div className="flex items-center justify-end gap-3 pt-1">
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={mutation.isPending || (readinessBlocked && !overrideReadiness)}
                >
                  {mutation.isPending ? 'Saving…' : 'Confirm move'}
                  {!mutation.isPending ? <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} /> : null}
                </Button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
