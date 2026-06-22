import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { SelectNative, type SelectOption } from '@/components/ui/select-native';
import {
  INVESTMENT_TYPE_LABELS,
  SOURCE_CHANNEL_LABELS,
  SYNDICATION_STATUS_LABELS,
} from '@/lib/dealChoices';
import { cn } from '@/lib/utils';
import type { DealFilters } from '@/types/deal';

function toOptions<T extends string>(labels: Record<T, string>): SelectOption[] {
  return (Object.entries(labels) as [T, string][]).map(([value, label]) => ({ value, label }));
}

const INVESTMENT_TYPE_OPTIONS = toOptions(INVESTMENT_TYPE_LABELS);
const SOURCE_CHANNEL_OPTIONS = toOptions(SOURCE_CHANNEL_LABELS);
const SYNDICATION_OPTIONS = toOptions(SYNDICATION_STATUS_LABELS);

interface FilterBarProps {
  filters: DealFilters;
  onChange: (patch: Partial<DealFilters>) => void;
  isStaff: boolean;
}

export function FilterBar({ filters, onChange, isStaff }: FilterBarProps) {
  // Local mirror so typing feels instant; push to the query after a short pause.
  const [searchDraft, setSearchDraft] = useState(filters.search ?? '');

  useEffect(() => {
    setSearchDraft(filters.search ?? '');
  }, [filters.search]);

  useEffect(() => {
    const next = searchDraft.trim();
    if (next === (filters.search ?? '')) return;
    const timer = setTimeout(() => onChange({ search: next || undefined }), 300);
    return () => clearTimeout(timer);
  }, [searchDraft, filters.search, onChange]);

  const myDealsActive = filters.assigned_analyst === 'me';

  const hasActiveFilters =
    Boolean(filters.search) ||
    Boolean(filters.investment_type) ||
    Boolean(filters.source_channel) ||
    Boolean(filters.syndication_status) ||
    Boolean(filters.assigned_analyst);

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
      <div className="relative min-w-0 flex-1 lg:max-w-md">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--slate)]"
          strokeWidth={1.75}
        />
        <input
          type="search"
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
          placeholder="Search deals by name"
          aria-label="Search deals by name"
          className="h-9 w-full rounded-sm border border-[var(--border)] bg-[var(--paper-elevated)] pl-9 pr-3 text-sm text-[var(--ink)] transition-colors placeholder:text-[var(--slate)]/70 hover:border-[var(--brass)]/40 focus-visible:border-[var(--brass)]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brass)]/20"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:flex lg:items-center">
        <SelectNative
          className="lg:w-44"
          aria-label="Filter by investment type"
          placeholder="All types"
          value={filters.investment_type ?? ''}
          options={INVESTMENT_TYPE_OPTIONS}
          onChange={(event) =>
            onChange({ investment_type: (event.target.value || undefined) as DealFilters['investment_type'] })
          }
        />
        <SelectNative
          className="lg:w-40"
          aria-label="Filter by source channel"
          placeholder="All sources"
          value={filters.source_channel ?? ''}
          options={SOURCE_CHANNEL_OPTIONS}
          onChange={(event) =>
            onChange({ source_channel: (event.target.value || undefined) as DealFilters['source_channel'] })
          }
        />
        <SelectNative
          className="lg:w-44"
          aria-label="Filter by syndication status"
          placeholder="All syndication"
          value={filters.syndication_status ?? ''}
          options={SYNDICATION_OPTIONS}
          onChange={(event) =>
            onChange({ syndication_status: (event.target.value || undefined) as DealFilters['syndication_status'] })
          }
        />
      </div>

      <div className="flex items-center gap-2">
        {isStaff ? (
          <button
            type="button"
            onClick={() => onChange({ assigned_analyst: myDealsActive ? undefined : 'me' })}
            aria-pressed={myDealsActive}
            className={cn(
              'h-9 whitespace-nowrap rounded-sm border px-3 text-sm font-medium transition-colors',
              myDealsActive
                ? 'border-[var(--brass)]/40 bg-[var(--brass)]/12 text-[var(--ink)]'
                : 'border-[var(--border)] bg-[var(--paper-elevated)] text-[var(--slate)] hover:border-[var(--brass)]/40 hover:text-[var(--ink)]',
            )}
          >
            My deals
          </button>
        ) : null}

        {hasActiveFilters ? (
          <button
            type="button"
            onClick={() =>
              onChange({
                search: undefined,
                investment_type: undefined,
                source_channel: undefined,
                syndication_status: undefined,
                assigned_analyst: undefined,
              })
            }
            className="inline-flex h-9 items-center gap-1.5 rounded-sm px-2.5 text-sm text-[var(--slate)] transition-colors hover:text-[var(--ink)]"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
            Clear
          </button>
        ) : null}
      </div>
    </div>
  );
}
