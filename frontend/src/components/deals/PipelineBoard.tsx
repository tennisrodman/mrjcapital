import { useMemo } from 'react';
import { DealCard } from '@/components/deals/DealCard';
import {
  PIPELINE_BOARD_ORDER,
  PIPELINE_OFF_PATH,
  PIPELINE_STATUS_LABELS,
  formatCurrencyCompact,
  pipelineStageNumber,
  stageAccent,
} from '@/lib/dealChoices';
import type { Deal, PipelineStatus } from '@/types/deal';

interface Column {
  status: PipelineStatus;
  deals: Deal[];
  total: number;
}

function groupByStage(deals: Deal[]): Column[] {
  const buckets = new Map<PipelineStatus, Deal[]>();
  for (const status of PIPELINE_BOARD_ORDER) buckets.set(status, []);
  for (const deal of deals) buckets.get(deal.pipeline_status)?.push(deal);

  return PIPELINE_BOARD_ORDER.map((status) => {
    const stageDeals = buckets.get(status) ?? [];
    const total = stageDeals.reduce((sum, deal) => sum + (Number(deal.requested_amount) || 0), 0);
    return { status, deals: stageDeals, total };
  }).filter((column) => !PIPELINE_OFF_PATH.includes(column.status) || column.deals.length > 0);
}

export function PipelineBoard({ deals }: { deals: Deal[] }) {
  const columns = useMemo(() => groupByStage(deals), [deals]);

  return (
    <div className="-mx-1 overflow-x-auto pb-2">
      <div className="flex min-w-max gap-3 px-1">
        {columns.map((column) => {
          const stage = pipelineStageNumber(column.status);
          return (
            <section
              key={column.status}
              className="flex w-[17rem] shrink-0 flex-col rounded-md border border-[var(--border)] bg-[var(--paper)]/60"
              aria-label={`${PIPELINE_STATUS_LABELS[column.status]} — ${column.deals.length} deals`}
            >
              <div
                className="h-[3px] rounded-t-md"
                style={{ backgroundColor: stageAccent(column.status) }}
                aria-hidden
              />
              <header className="flex items-baseline justify-between gap-2 px-3 py-2.5">
                <div className="flex items-baseline gap-2">
                  {stage !== null ? (
                    <span className="font-display text-xs font-medium tabular-nums text-[var(--slate)]/60">
                      {String(stage).padStart(2, '0')}
                    </span>
                  ) : null}
                  <h2 className="text-sm font-semibold tracking-tight text-[var(--ink)]">
                    {PIPELINE_STATUS_LABELS[column.status]}
                  </h2>
                  <span className="text-xs font-medium tabular-nums text-[var(--slate)]">
                    {column.deals.length}
                  </span>
                </div>
                {column.total > 0 ? (
                  <span className="font-display text-xs font-medium tabular-nums text-[var(--brass)]">
                    {formatCurrencyCompact(column.total)}
                  </span>
                ) : null}
              </header>

              <div className="flex flex-1 flex-col gap-2 px-2 pb-2">
                {column.deals.length === 0 ? (
                  <p className="rounded-sm border border-dashed border-[var(--border)] px-3 py-6 text-center text-xs text-[var(--slate)]/70">
                    No deals
                  </p>
                ) : (
                  column.deals.map((deal) => <DealCard key={deal.id} deal={deal} />)
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
