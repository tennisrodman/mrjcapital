import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/dealChoices';
import { cn } from '@/lib/utils';
import type { Quote } from '@/types/quote';
import { QUOTE_STATUS_LABELS } from '@/types/quote';

function ordered(quotes: Quote[]): Quote[] {
  return [...quotes].sort((a, b) => {
    if (a.version !== b.version) return b.version - a.version;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

function statusBadgeClass(status: Quote['status']): string {
  switch (status) {
    case 'executed':
      return 'border-[var(--brass)]/35 bg-[var(--brass)]/15 text-[var(--ink)]';
    case 'sent':
    case 'countered':
      return 'border-[var(--brass)]/25 bg-[var(--brass)]/8 text-[var(--ink)]';
    case 'expired':
    case 'withdrawn':
      return 'border-[var(--border)] bg-[var(--paper-elevated)] text-[var(--slate)]';
    case 'draft':
      return 'border-[var(--border)] bg-[var(--paper-elevated)] text-[var(--slate)]';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

export function QuoteHistory({
  quotes,
  currentId,
}: {
  quotes: Quote[];
  currentId?: string;
}) {
  if (quotes.length === 0) {
    return (
      <p className="text-sm text-[var(--slate)]">
        No quote saved yet. Creating the first draft starts v1.
      </p>
    );
  }

  return (
    <ol className="space-y-2" aria-label="Quote version history">
      {ordered(quotes).map((quote) => {
        const current = quote.id === currentId;
        return (
          <li
            key={quote.id}
            aria-current={current ? 'true' : undefined}
            className={cn(
              'rounded-sm border px-3 py-2.5',
              current
                ? 'border-[var(--brass)]/45 bg-[var(--brass)]/8'
                : 'border-[var(--border)] bg-[var(--paper)]',
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-[var(--ink)]">
                v{quote.version}
                {quote.is_counter ? (
                  <span className="ml-1.5 text-xs font-normal text-[var(--slate)]">Counter</span>
                ) : null}
                {current ? (
                  <span className="ml-1.5 text-xs font-normal text-[var(--brass)]">Current</span>
                ) : null}
              </p>
              <Badge className={statusBadgeClass(quote.status)}>
                {QUOTE_STATUS_LABELS[quote.status]}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-[var(--slate)]">
              Updated {formatDateTime(quote.updated_at)}
              {quote.sent_at ? ` · Sent ${formatDateTime(quote.sent_at)}` : ''}
              {quote.signed_at ? ` · Executed ${formatDateTime(quote.signed_at)}` : ''}
              {quote.withdrawn_at ? ` · Withdrawn ${formatDateTime(quote.withdrawn_at)}` : ''}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
