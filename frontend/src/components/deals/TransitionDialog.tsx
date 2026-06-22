import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowRight, X } from 'lucide-react';
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setToStatus('');
      setReason('');
      setError(null);
    }
  }, [open]);

  const labels = kind === 'pipeline' ? PIPELINE_STATUS_LABELS : SYNDICATION_STATUS_LABELS;
  const targets = (kind === 'pipeline'
    ? allowed.data?.pipeline_status
    : allowed.data?.syndication_status) ?? [];
  const options = targets.map((value) => ({ value, label: labels[value as keyof typeof labels] }));

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
    mutation.mutate(
      { to_status: toStatus, reason: reason.trim() },
      {
        onSuccess: () => onOpenChange(false),
        onError: (err) => {
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
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-md border border-[var(--border)] bg-[var(--paper-elevated)] p-6 shadow-2xl focus:outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
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
            <Dialog.Close className="rounded-sm p-1 text-[var(--slate)] transition-colors hover:bg-[var(--ink)]/5 hover:text-[var(--ink)]">
              <X className="h-4 w-4" strokeWidth={1.75} />
            </Dialog.Close>
          </div>

          {allowed.isLoading ? (
            <p className="mt-5 text-sm text-[var(--slate)]">Loading available moves…</p>
          ) : options.length === 0 ? (
            <div className="mt-5 rounded-sm border border-dashed border-[var(--border)] bg-[var(--paper)] px-4 py-6 text-center text-sm text-[var(--slate)]">
              No moves are available from {currentLabel.toLowerCase()}.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="mt-5 space-y-4">
              <FormField label="Move to">
                <SelectNative
                  placeholder="Select a status"
                  options={options}
                  value={toStatus}
                  onChange={(event) => setToStatus(event.target.value)}
                />
              </FormField>
              <FormField label="Reason" required>
                <Textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Why is this deal moving? This is recorded in the activity log."
                />
              </FormField>

              {error ? <p className="text-sm text-red-600">{error}</p> : null}

              <div className="flex items-center justify-end gap-3 pt-1">
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={mutation.isPending}>
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
