import { useContext, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, CircleDollarSign, Clock, FolderOpen, TrendingUp } from 'lucide-react';
import { AuthContext } from '@/context/AuthContext';
import { useDeals, useDealSummary } from '@/lib/api/deals';
import {
  formatCurrencyCompact,
  PIPELINE_STATUS_LABELS,
} from '@/lib/dealChoices';
import type { Deal, DealFilters, PipelineStatus } from '@/types/deal';

const DASHBOARD_FILTERS: DealFilters = {};
const EMPTY_DEALS: Deal[] = [];

const REVIEW_STATUSES: PipelineStatus[] = ['screening', 'quoting', 'negotiating', 'signed'];
const FUNDED_STATUSES: PipelineStatus[] = ['closed', 'servicing', 'exited'];

const pipelineStageGroups: { stage: string; statuses: PipelineStatus[]; tone: string }[] = [
  { stage: 'Origination', statuses: ['sourced', 'screening'], tone: 'bg-[var(--ink)]/20' },
  { stage: 'Underwriting', statuses: ['quoting', 'negotiating', 'signed'], tone: 'bg-[var(--brass)]/35' },
  { stage: 'Closing', statuses: ['closing'], tone: 'bg-[var(--brass)]/60' },
  { stage: 'Funded', statuses: FUNDED_STATUSES, tone: 'bg-[var(--brass)]' },
];

const HomePage = () => {
  const { user } = useContext(AuthContext);
  const dealsQuery = useDeals(DASHBOARD_FILTERS);
  const summaryQuery = useDealSummary(DASHBOARD_FILTERS);
  const deals = dealsQuery.data ?? EMPTY_DEALS;

  const inReview = useMemo(
    () => deals.filter((deal) => REVIEW_STATUSES.includes(deal.pipeline_status)).length,
    [deals],
  );
  const fundedVolume = useMemo(
    () => sumRequestedAmount(deals.filter((deal) => FUNDED_STATUSES.includes(deal.pipeline_status))),
    [deals],
  );
  const featuredDeals = useMemo(
    () => deals.filter((deal) => !['dead', 'exited'].includes(deal.pipeline_status)).slice(0, 5),
    [deals],
  );

  const stats = [
    {
      label: 'Active deals',
      value: summaryQuery.data?.active_deals.toLocaleString('en-US') ?? '—',
      hint: 'Excludes dead and exited',
      icon: FolderOpen,
    },
    {
      label: 'In review',
      value: inReview.toLocaleString('en-US'),
      hint: 'Screening through signed',
      icon: Clock,
    },
    {
      label: 'Funded / exited',
      value: formatCurrencyCompact(fundedVolume),
      hint: 'Closed, servicing, exited',
      icon: CircleDollarSign,
    },
    {
      label: 'Pipeline value',
      value: formatCurrencyCompact(summaryQuery.data?.pipeline_value),
      hint: 'Active requested amount',
      icon: TrendingUp,
    },
  ];

  const isLoading = dealsQuery.isLoading || summaryQuery.isLoading;
  const isError = dealsQuery.isError || summaryQuery.isError;

  return (
    <div className="space-y-10">
      <header className="animate-fade-up flex flex-col gap-4 border-b border-[var(--border)] pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--slate)]">
            Portfolio overview
          </p>
          <h1 className="font-display mt-2 text-3xl font-medium tracking-tight text-[var(--ink)] sm:text-4xl">
            Good {getGreeting()}, {user?.username}
          </h1>
          <p className="mt-2 max-w-xl text-[var(--slate)]">
            Track acquisition financing, bridge loans, and refi packages from origination through funding.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-sm text-[var(--slate)]">
          <span className="rounded-sm border border-[var(--border)] bg-[var(--paper-elevated)] px-3 py-1.5">
            Q2 2026
          </span>
        </div>
      </header>

      <section className="animate-fade-up stagger-1 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map(({ label, value, hint, icon: Icon }) => (
          <article
            key={label}
            className="rounded-md border border-[var(--border)] bg-[var(--paper-elevated)] p-5 shadow-[0_1px_0_rgba(20,24,32,0.04)]"
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-[var(--slate)]">{label}</p>
              <Icon className="h-4 w-4 text-[var(--brass)]" strokeWidth={1.75} />
            </div>
            <p className="font-display mt-3 text-3xl font-medium tracking-tight text-[var(--ink)]">
              {isLoading ? '...' : value}
            </p>
            <p className="mt-1 text-xs text-[var(--slate)]">{hint}</p>
          </article>
        ))}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="animate-fade-up stagger-2 rounded-md border border-[var(--border)] bg-[var(--paper-elevated)]">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
            <div>
              <h2 className="font-display text-lg font-medium text-[var(--ink)]">Deal pipeline</h2>
              <p className="text-sm text-[var(--slate)]">Properties moving through your lending workflow</p>
            </div>
          </div>

          {isLoading ? (
            <div className="px-5 py-10 text-center text-sm text-[var(--slate)]">Loading dashboard...</div>
          ) : isError ? (
            <div className="px-5 py-10 text-center">
              <h3 className="font-medium text-[var(--ink)]">Could not load dashboard data</h3>
              <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--slate)]">
                Check the selected data mode and backend connection, then refresh.
              </p>
            </div>
          ) : featuredDeals.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-sm border border-dashed border-[var(--border)] bg-[var(--paper)]">
                <FolderOpen className="h-5 w-5 text-[var(--slate)]" strokeWidth={1.5} />
              </div>
              <h3 className="mt-4 font-medium text-[var(--ink)]">No deals yet</h3>
              <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--slate)]">
                Create your first financing package to track property details, term sheets, and closing milestones.
              </p>
              <Link
                to="/deals/new"
                className="mt-6 inline-flex items-center gap-2 rounded-sm border border-[var(--brass)]/30 bg-[var(--brass)]/10 px-4 py-2 text-sm font-medium text-[var(--brass)] transition-colors hover:border-[var(--brass)]/60 hover:bg-[var(--brass)]/15"
              >
                Add deal
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {featuredDeals.map((deal) => {
                const location = primaryLocation(deal);
                return (
                  <Link
                    key={deal.id}
                    to={`/deals/${deal.id}`}
                    className="grid gap-3 px-5 py-4 transition-colors hover:bg-[var(--paper)] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate font-medium text-[var(--ink)]">{deal.name}</h3>
                        <span className="rounded-sm border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--slate)]">
                          {PIPELINE_STATUS_LABELS[deal.pipeline_status]}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-sm text-[var(--slate)]">
                        {deal.sponsor_detail?.entity_name ?? 'Sponsor on file'}
                        {location ? ` · ${location}` : ''}
                      </p>
                    </div>
                    <div className="font-display text-lg font-medium text-[var(--brass)]">
                      {formatCurrencyCompact(deal.requested_amount)}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <aside className="animate-fade-up stagger-3 space-y-6">
          <section className="rounded-md border border-[var(--border)] bg-[var(--paper-elevated)] p-5">
            <h2 className="font-display text-lg font-medium text-[var(--ink)]">By stage</h2>
            <ul className="mt-4 space-y-3">
              {pipelineStageGroups.map(({ stage, statuses, tone }) => (
                <li key={stage} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 text-[var(--slate)]">
                    <span className={`h-2 w-2 rounded-full ${tone}`} />
                    {stage}
                  </span>
                  <span className="font-medium tabular-nums text-[var(--ink)]">
                    {isLoading ? '...' : countDealsInStatuses(deals, statuses)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-md border border-[var(--border)] bg-[var(--ink)] p-5 text-[var(--header-fg)]">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--header-muted)]">
              Next up
            </p>
            <p className="font-display mt-3 text-lg leading-snug">
              Review the highest-priority quote packages and closing milestones.
            </p>
            <p className="mt-2 text-sm text-[var(--header-muted)]">
              Demo mode uses the seeded portfolio; Live mode reads the Django API.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
};

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function sumRequestedAmount(deals: Deal[]): number {
  return deals.reduce((total, deal) => total + (Number(deal.requested_amount) || 0), 0);
}

function countDealsInStatuses(deals: Deal[], statuses: PipelineStatus[]): number {
  return deals.filter((deal) => statuses.includes(deal.pipeline_status)).length;
}

function primaryLocation(deal: Deal): string | null {
  const primary = deal.properties.find((entry) => entry.is_primary) ?? deal.properties[0];
  if (!primary) return null;
  return [primary.property.city, primary.property.state].filter(Boolean).join(', ') || null;
}

export default HomePage;
