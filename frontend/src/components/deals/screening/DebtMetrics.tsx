import type { DebtScreeningOutputs } from '@/types/screening';

function percentage(value: string | null): string {
  if (value === null) return '—';
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function multiple(value: string | null): string {
  return value === null ? '—' : `${value}x`;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-sm border border-[var(--border)] bg-[var(--paper)] px-3 py-3">
      <dt className="text-[0.65rem] font-medium uppercase tracking-[0.1em] text-[var(--slate)]">{label}</dt>
      <dd className="font-display mt-1 text-2xl font-medium tabular-nums text-[var(--ink)]">{value}</dd>
      <p className="mt-1 text-xs text-[var(--slate)]">{detail}</p>
    </div>
  );
}

/** Live, local outputs. The server remains the source of truth when a draft is saved. */
export function DebtMetrics({ metrics }: { metrics: DebtScreeningOutputs }) {
  const hasCalculatedMetric = [
    metrics.ltv_as_is,
    metrics.ltv_stabilized,
    metrics.ltc,
    metrics.dscr,
    metrics.debt_yield,
  ].some((value) => value !== null);
  const score = hasCalculatedMetric ? `${metrics.quick_score} / 100` : 'Needs more inputs';

  return (
    <section aria-labelledby="calculated-debt-metrics" className="space-y-3">
      <div>
        <h2 id="calculated-debt-metrics" className="font-display text-base font-medium tracking-tight text-[var(--ink)]">
          Calculated debt metrics
        </h2>
        <p className="mt-1 text-xs text-[var(--slate)]">
          Updates locally as you type. Ratios are indicative until the draft is saved.
        </p>
      </div>
      <dl aria-live="polite" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Metric label="LTV · as-is" value={percentage(metrics.ltv_as_is)} detail="Debt / as-is value" />
        <Metric
          label="LTV · stabilized"
          value={percentage(metrics.ltv_stabilized)}
          detail="Debt / stabilized value"
        />
        <Metric label="LTC" value={percentage(metrics.ltc)} detail="Debt / total cost" />
        <Metric label="DSCR" value={multiple(metrics.dscr)} detail="NOI / debt service" />
        <Metric label="Debt yield" value={percentage(metrics.debt_yield)} detail="NOI / debt" />
        <Metric label="Quick score" value={score} detail="Heuristic, not a credit decision" />
      </dl>
    </section>
  );
}
