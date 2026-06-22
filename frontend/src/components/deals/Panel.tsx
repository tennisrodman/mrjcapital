import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Panel({
  title,
  count,
  action,
  children,
  className,
}: {
  title: string;
  count?: number;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'rounded-md border border-[var(--border)] bg-[var(--paper-elevated)]',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3.5">
        <h2 className="font-display text-base font-medium tracking-tight text-[var(--ink)]">
          {title}
          {count !== undefined ? (
            <span className="ml-2 text-sm font-normal tabular-nums text-[var(--slate)]">{count}</span>
          ) : null}
        </h2>
        {action}
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[0.7rem] font-medium uppercase tracking-[0.1em] text-[var(--slate)]">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-[var(--ink)]">{children ?? '—'}</dd>
    </div>
  );
}
