import {
  ArrowRightLeft,
  Check,
  ClipboardList,
  FileSignature,
  Layers,
  Pencil,
  ScanSearch,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import type { AllowedTransitions } from '@/lib/api/deals';
import {
  PIPELINE_BOARD_ORDER,
  PIPELINE_LINEAR,
  PIPELINE_STATUS_LABELS,
} from '@/lib/dealChoices';
import { cn } from '@/lib/utils';
import type { Deal, PipelineStatus } from '@/types/deal';

const LIFECYCLE_STAGES: PipelineStatus[] = [...PIPELINE_LINEAR, 'exited'];

interface DealWorkflowNavigationProps {
  deal: Deal;
  allowedTransitions?: AllowedTransitions;
  transitionsLoading: boolean;
  showClosingLink: boolean;
  onMoveStage: () => void;
  onSyndication: () => void;
}

function orderedMoves(statuses: PipelineStatus[]): PipelineStatus[] {
  return [...statuses].sort(
    (left, right) => PIPELINE_BOARD_ORDER.indexOf(left) - PIPELINE_BOARD_ORDER.indexOf(right),
  );
}

export function DealWorkflowNavigation({
  deal,
  allowedTransitions,
  transitionsLoading,
  showClosingLink,
  onMoveStage,
  onSyndication,
}: DealWorkflowNavigationProps) {
  const pathStatus = deal.pipeline_status === 'on_hold'
    ? deal.paused_from_status
    : deal.pipeline_status;
  const currentIndex = pathStatus ? LIFECYCLE_STAGES.indexOf(pathStatus) : -1;
  const availableMoves = orderedMoves(allowedTransitions?.pipeline_status ?? []);
  const exceptionalStatus = deal.pipeline_status === 'on_hold' || deal.pipeline_status === 'dead';

  return (
    <div className="space-y-4">
      <section
        className="rounded-md border border-[var(--border)] bg-[var(--paper-elevated)] p-4 shadow-[0_1px_0_rgba(20,24,32,0.04)] sm:p-5"
        aria-labelledby="deal-lifecycle-title"
      >
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div>
            <p className="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-[var(--brass)]">
              Deal lifecycle
            </p>
            <h2 id="deal-lifecycle-title" className="mt-1 font-display text-lg font-medium text-[var(--ink)]">
              Current stage: {PIPELINE_STATUS_LABELS[deal.pipeline_status]}
            </h2>
          </div>
          {deal.pipeline_status === 'on_hold' && deal.paused_from_status ? (
            <p className="text-sm text-[var(--slate)]">
              Paused from {PIPELINE_STATUS_LABELS[deal.paused_from_status]}
            </p>
          ) : null}
          {deal.pipeline_status === 'dead' ? (
            <p className="text-sm text-[var(--slate)]">This deal has left the active path.</p>
          ) : null}
        </div>

        <div className="mt-5 overflow-x-auto pb-1">
          <ol
            className="grid min-w-[840px] grid-cols-9"
            aria-label="Deal lifecycle stages"
          >
            {LIFECYCLE_STAGES.map((status, index) => {
              const current = !exceptionalStatus && deal.pipeline_status === status;
              const pausedHere = deal.pipeline_status === 'on_hold' && pathStatus === status;
              const completed = currentIndex > index;
              return (
                <li
                  key={status}
                  className="relative flex min-w-0 flex-col items-center px-1 text-center"
                  aria-current={current || pausedHere ? 'step' : undefined}
                >
                  {index < LIFECYCLE_STAGES.length - 1 ? (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'absolute left-1/2 top-3 h-px w-full',
                        completed ? 'bg-[var(--brass)]' : 'bg-[var(--border)]',
                      )}
                    />
                  ) : null}
                  <span
                    className={cn(
                      'relative z-10 flex h-6 w-6 items-center justify-center rounded-full border text-[0.68rem] font-semibold',
                      completed && 'border-[var(--brass)] bg-[var(--brass)] text-white',
                      current && 'border-[var(--ink)] bg-[var(--ink)] text-white ring-4 ring-[var(--brass)]/15',
                      pausedHere && 'border-amber-500 bg-amber-50 text-amber-800 ring-4 ring-amber-100',
                      !completed && !current && !pausedHere
                        && 'border-[var(--border)] bg-[var(--paper-elevated)] text-[var(--slate)]',
                    )}
                  >
                    {completed ? <Check className="h-3 w-3" strokeWidth={2.25} /> : index + 1}
                  </span>
                  <span
                    className={cn(
                      'mt-2 text-xs leading-tight',
                      current || pausedHere ? 'font-semibold text-[var(--ink)]' : 'text-[var(--slate)]',
                    )}
                  >
                    {PIPELINE_STATUS_LABELS[status]}
                  </span>
                  {pausedHere ? (
                    <span className="mt-0.5 text-[0.65rem] font-medium text-amber-700">Paused here</span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </div>

        <div className="mt-5 flex flex-col gap-3 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--slate)]">
              Available moves
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5" aria-live="polite">
              {transitionsLoading ? (
                <span className="text-sm text-[var(--slate)]">Checking stage options…</span>
              ) : availableMoves.length > 0 ? (
                availableMoves.map((status) => {
                  const readiness = allowedTransitions?.readiness[status];
                  return (
                    <span
                      key={status}
                      className="rounded-full border border-[var(--border)] bg-[var(--paper)] px-2.5 py-1 text-xs text-[var(--ink-muted)]"
                    >
                      {PIPELINE_STATUS_LABELS[status]}
                      {readiness && !readiness.ready
                        ? ` · ${readiness.blockers.length} requirement${readiness.blockers.length === 1 ? '' : 's'}`
                        : ''}
                    </span>
                  );
                })
              ) : (
                <span className="text-sm text-[var(--slate)]">No further stage moves are available.</span>
              )}
            </div>
          </div>
          <Button type="button" onClick={onMoveStage} disabled={!transitionsLoading && availableMoves.length === 0}>
            <ArrowRightLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            Change stage
          </Button>
        </div>
      </section>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <nav aria-label="Workflow workspaces">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--slate)]">
            Workflow workspaces
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" asChild>
              <Link to={`/deals/${deal.id}/screening`}>
                <ScanSearch className="h-3.5 w-3.5" strokeWidth={1.75} />
                1. Screening
              </Link>
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link to={`/deals/${deal.id}/quotes`}>
                <FileSignature className="h-3.5 w-3.5" strokeWidth={1.75} />
                2. Quotes
              </Link>
            </Button>
            {showClosingLink ? (
              <Button type="button" variant="outline" asChild>
                <Link to={`/deals/${deal.id}/closing`}>
                  <ClipboardList className="h-3.5 w-3.5" strokeWidth={1.75} />
                  3. Closing
                </Link>
              </Button>
            ) : null}
          </div>
        </nav>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--slate)]">
            Deal tools
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={onSyndication}>
              <Layers className="h-3.5 w-3.5" strokeWidth={1.75} />
              Syndication
            </Button>
            <Button type="button" variant="outline" asChild>
              <Link to={`/deals/${deal.id}/edit`}>
                <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                Edit deal
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
