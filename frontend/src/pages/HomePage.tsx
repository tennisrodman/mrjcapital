import { useContext } from 'react';
import { ArrowUpRight, CircleDollarSign, Clock, FolderOpen, TrendingUp } from 'lucide-react';
import { AuthContext } from '@/context/AuthContext';

const stats = [
  { label: 'Active deals', value: '—', hint: 'In underwriting', icon: FolderOpen },
  { label: 'In review', value: '—', hint: 'Awaiting docs', icon: Clock },
  { label: 'Funded YTD', value: '—', hint: 'Closed volume', icon: CircleDollarSign },
  { label: 'Pipeline value', value: '—', hint: 'Total exposure', icon: TrendingUp },
] as const;

const pipelineStages = [
  { stage: 'Origination', count: 0, tone: 'bg-[var(--ink)]/8' },
  { stage: 'Underwriting', count: 0, tone: 'bg-[var(--brass)]/15' },
  { stage: 'Closing', count: 0, tone: 'bg-[var(--brass)]/25' },
  { stage: 'Funded', count: 0, tone: 'bg-[var(--brass)]/40' },
] as const;

const HomePage = () => {
  const { user } = useContext(AuthContext);

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
            <p className="font-display mt-3 text-3xl font-medium tracking-tight text-[var(--ink)]">{value}</p>
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

          <div className="px-5 py-10 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-sm border border-dashed border-[var(--border)] bg-[var(--paper)]">
              <FolderOpen className="h-5 w-5 text-[var(--slate)]" strokeWidth={1.5} />
            </div>
            <h3 className="mt-4 font-medium text-[var(--ink)]">No deals yet</h3>
            <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--slate)]">
              Create your first financing package to track property details, term sheets, and closing milestones.
            </p>
            <button
              type="button"
              disabled
              className="mt-6 inline-flex cursor-not-allowed items-center gap-2 rounded-sm border border-[var(--brass)]/30 bg-[var(--brass)]/10 px-4 py-2 text-sm font-medium text-[var(--brass)] opacity-60"
            >
              Add deal
              <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </section>

        <aside className="animate-fade-up stagger-3 space-y-6">
          <section className="rounded-md border border-[var(--border)] bg-[var(--paper-elevated)] p-5">
            <h2 className="font-display text-lg font-medium text-[var(--ink)]">By stage</h2>
            <ul className="mt-4 space-y-3">
              {pipelineStages.map(({ stage, count, tone }) => (
                <li key={stage} className="flex items-center justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2 text-[var(--slate)]">
                    <span className={`h-2 w-2 rounded-full ${tone}`} />
                    {stage}
                  </span>
                  <span className="font-medium tabular-nums text-[var(--ink)]">{count}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-md border border-[var(--border)] bg-[var(--ink)] p-5 text-[var(--header-fg)]">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-[var(--header-muted)]">
              Next up
            </p>
            <p className="font-display mt-3 text-lg leading-snug">
              Wire up deal models and document uploads in the API layer.
            </p>
            <p className="mt-2 text-sm text-[var(--header-muted)]">
              This dashboard is ready for live data once backend endpoints land.
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

export default HomePage;
