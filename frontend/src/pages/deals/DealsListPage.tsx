import { useCallback, useContext, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Columns3, FolderOpen, Plus, Table2 } from 'lucide-react';
import { AuthContext } from '@/context/AuthContext';
import { FilterBar } from '@/components/deals/FilterBar';
import { SummaryStrip } from '@/components/deals/SummaryStrip';
import { PipelineBoard } from '@/components/deals/PipelineBoard';
import { DealsTable } from '@/components/deals/DealsTable';
import { EmptyState, ErrorState, Spinner } from '@/components/deals/States';
import { useDealSummary, useDeals } from '@/lib/api/deals';
import { cn } from '@/lib/utils';
import type { DealFilters } from '@/types/deal';

type DealView = 'board' | 'table';

const FILTER_KEYS: (keyof DealFilters)[] = [
  'search',
  'investment_type',
  'source_channel',
  'syndication_status',
  'assigned_analyst',
];

function readFilters(params: URLSearchParams): DealFilters {
  const filters: DealFilters = {};
  for (const key of FILTER_KEYS) {
    const value = params.get(key);
    if (value) filters[key] = value as never;
  }
  return filters;
}

export default function DealsListPage() {
  const { user } = useContext(AuthContext);
  const isStaff = Boolean(user?.is_staff);
  const [searchParams, setSearchParams] = useSearchParams();

  const view: DealView = searchParams.get('view') === 'table' ? 'table' : 'board';
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);

  const patchFilters = useCallback(
    (patch: Partial<DealFilters>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(patch)) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setView = useCallback(
    (nextView: DealView) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('view', nextView);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const dealsQuery = useDeals(filters);
  const summaryQuery = useDealSummary(filters);
  const deals = dealsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <header className="animate-fade-up flex flex-col gap-4 border-b border-[var(--border)] pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--slate)]">
            Pipeline
          </p>
          <h1 className="font-display mt-2 text-3xl font-medium tracking-tight text-[var(--ink)]">
            Deals
          </h1>
          <p className="mt-2 max-w-xl text-[var(--slate)]">
            Every position MRJ is sourcing, underwriting, and servicing — tracked from first look to exit.
          </p>
        </div>
        <Link
          to="/deals/new"
          className="inline-flex items-center gap-2 self-start rounded-sm bg-[var(--ink)] px-4 py-2 text-sm font-medium text-[var(--paper)] transition-colors hover:bg-[var(--ink-muted)] sm:self-auto"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          New deal
        </Link>
      </header>

      <div className="animate-fade-up stagger-1">
        <SummaryStrip summary={summaryQuery.data} isLoading={summaryQuery.isLoading} />
      </div>

      <div className="animate-fade-up stagger-2 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <FilterBar filters={filters} onChange={patchFilters} isStaff={isStaff} />
        <ViewToggle view={view} onChange={setView} />
      </div>

      <div className="animate-fade-up stagger-3">
        {dealsQuery.isLoading ? (
          <Spinner label="Loading deals…" />
        ) : dealsQuery.isError ? (
          <ErrorState
            title="Couldn't load deals"
            message="The pipeline didn't come back from the server. Check your connection and try again."
            onRetry={() => void dealsQuery.refetch()}
          />
        ) : deals.length === 0 ? (
          <EmptyState
            icon={FolderOpen}
            title={hasFilters(filters) ? 'No deals match these filters' : 'No deals yet'}
            message={
              hasFilters(filters)
                ? 'Try widening your search or clearing a filter to see more of the pipeline.'
                : 'Once deals are created they’ll appear here, grouped by pipeline stage.'
            }
          />
        ) : (
          <>
            {view === 'board' ? <PipelineBoard deals={deals} /> : <DealsTable deals={deals} />}
            <p className="mt-3 text-xs text-[var(--slate)]">
              Showing {deals.length} {deals.length === 1 ? 'deal' : 'deals'}
              {dealsQuery.isFetching ? ' · refreshing…' : ''}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function hasFilters(filters: DealFilters): boolean {
  return FILTER_KEYS.some((key) => Boolean(filters[key]));
}

function ViewToggle({ view, onChange }: { view: DealView; onChange: (view: DealView) => void }) {
  const options: { value: DealView; label: string; icon: typeof Columns3 }[] = [
    { value: 'board', label: 'Board', icon: Columns3 },
    { value: 'table', label: 'Table', icon: Table2 },
  ];
  return (
    <div
      className="inline-flex shrink-0 self-start rounded-sm border border-[var(--border)] bg-[var(--paper-elevated)] p-0.5"
      role="group"
      aria-label="Switch deals view"
    >
      {options.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          aria-pressed={view === value}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-[3px] px-3 py-1.5 text-sm font-medium transition-colors',
            view === value
              ? 'bg-[var(--ink)] text-[var(--paper)]'
              : 'text-[var(--slate)] hover:text-[var(--ink)]',
          )}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
          {label}
        </button>
      ))}
    </div>
  );
}
