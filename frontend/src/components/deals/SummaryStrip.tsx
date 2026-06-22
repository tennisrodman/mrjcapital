import { CircleDollarSign, FolderOpen, Layers } from 'lucide-react';
import { Skeleton } from '@/components/deals/States';
import { formatCurrency } from '@/lib/dealChoices';
import type { DealSummary } from '@/types/deal';

interface SummaryStripProps {
  summary: DealSummary | undefined;
  isLoading: boolean;
}

export function SummaryStrip({ summary, isLoading }: SummaryStripProps) {
  const items = [
    {
      label: 'Active deals',
      hint: 'Excludes dead & exited',
      icon: FolderOpen,
      value: summary ? summary.active_deals.toLocaleString('en-US') : null,
    },
    {
      label: 'Active pipeline',
      hint: 'Requested, in-flight',
      icon: CircleDollarSign,
      value: summary ? formatCurrency(summary.pipeline_value) : null,
    },
    {
      label: 'Gross pipeline',
      hint: 'All deals, requested',
      icon: Layers,
      value: summary ? formatCurrency(summary.gross_pipeline_value) : null,
    },
  ];

  return (
    <dl className="grid gap-px overflow-hidden rounded-md border border-[var(--border)] bg-[var(--border)] sm:grid-cols-3">
      {items.map(({ label, hint, icon: Icon, value }) => (
        <div key={label} className="bg-[var(--paper-elevated)] px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-sm font-medium text-[var(--slate)]">{label}</dt>
            <Icon className="h-4 w-4 text-[var(--brass)]" strokeWidth={1.75} />
          </div>
          {isLoading && value === null ? (
            <Skeleton className="mt-3 h-8 w-28" />
          ) : (
            <dd className="font-display mt-2 text-2xl font-medium tracking-tight tabular-nums text-[var(--ink)]">
              {value ?? '—'}
            </dd>
          )}
          <p className="mt-1 text-xs text-[var(--slate)]">{hint}</p>
        </div>
      ))}
    </dl>
  );
}
