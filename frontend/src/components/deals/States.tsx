import type { ComponentType, ReactNode } from 'react';
import { AlertTriangle, type LucideProps } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Brass-on-paper spinner, consistent with the workspace loading state. */
export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16">
      <span className="flex h-10 w-10 items-center justify-center rounded-sm border border-[var(--brass)]/30 bg-[var(--brass)]/10">
        <span className="h-4 w-4 animate-pulse rounded-sm bg-[var(--brass)]/40" />
      </span>
      {label ? <p className="text-sm text-[var(--slate)]">{label}</p> : null}
    </div>
  );
}

/** A shimmer placeholder block for skeleton layouts. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-sm bg-[var(--ink)]/6', className)} />;
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--paper-elevated)] px-6 py-12 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-sm border border-dashed border-[var(--border)] bg-[var(--paper)]">
        <AlertTriangle className="h-5 w-5 text-[var(--brass)]" strokeWidth={1.5} />
      </div>
      <h3 className="mt-4 font-medium text-[var(--ink)]">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--slate)]">
        {message ?? 'The request could not be completed. Try again in a moment.'}
      </p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 inline-flex items-center gap-2 rounded-sm border border-[var(--brass)]/30 bg-[var(--brass)]/10 px-4 py-2 text-sm font-medium text-[var(--brass)] transition-colors hover:bg-[var(--brass)]/15"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  message,
  action,
}: {
  icon: ComponentType<LucideProps>;
  title: string;
  message: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--paper-elevated)] px-6 py-14 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-sm border border-dashed border-[var(--border)] bg-[var(--paper)]">
        <Icon className="h-5 w-5 text-[var(--slate)]" strokeWidth={1.5} />
      </div>
      <h3 className="mt-4 font-medium text-[var(--ink)]">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm text-[var(--slate)]">{message}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
