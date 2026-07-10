import { Clock3 } from 'lucide-react';

import { Panel } from '@/components/deals/Panel';
import { Button } from '@/components/ui/button';
import { PIPELINE_STATUS_LABELS, formatDateTime } from '@/lib/dealChoices';
import type { DealStageEvent } from '@/types/deal';

export function StageHistoryPanel({
  events,
  isLoading,
  isError = false,
  onRetry,
}: {
  events: DealStageEvent[];
  isLoading: boolean;
  isError?: boolean;
  onRetry?: () => void;
}) {
  return (
    <Panel title="Stage history" count={events.length}>
      {isLoading ? (
        <p className="text-sm text-[var(--slate)]">Loading stage history…</p>
      ) : isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-[var(--slate)]">
          <p>Stage history could not be loaded.</p>
          {onRetry ? (
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              Try again
            </Button>
          ) : null}
        </div>
      ) : events.length === 0 ? (
        <p className="text-sm text-[var(--slate)]">No stage history recorded yet.</p>
      ) : (
        <ol className="space-y-3">
          {events.map((event) => (
            <li key={event.id} className="flex gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--paper)] text-[var(--brass)]">
                <Clock3 className="h-3.5 w-3.5" strokeWidth={1.75} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--ink)]">
                  {PIPELINE_STATUS_LABELS[event.to_status]}
                  {event.exited_at === null ? (
                    <span className="ml-1.5 text-xs font-normal text-[var(--brass)]">Current</span>
                  ) : null}
                </p>
                <p className="text-xs text-[var(--slate)]">Entered {formatDateTime(event.entered_at)}</p>
                {event.reason ? <p className="mt-1 text-xs text-[var(--ink-muted)]">{event.reason}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
