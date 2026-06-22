import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  type ColumnDef,
  type RowData,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { InvestmentChip, PipelineBadge, SyndicationBadge } from '@/components/deals/StatusBadge';
import {
  SOURCE_CHANNEL_LABELS,
  formatCurrency,
  formatDate,
} from '@/lib/dealChoices';
import { cn } from '@/lib/utils';
import type { Deal } from '@/types/deal';

declare module '@tanstack/react-table' {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: 'left' | 'right';
  }
}

export function DealsTable({ deals }: { deals: Deal[] }) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'source_date', desc: true }]);

  const columns = useMemo<ColumnDef<Deal>[]>(
    () => [
      {
        id: 'name',
        accessorFn: (deal) => deal.name,
        header: 'Deal',
        cell: ({ row }) => (
          <Link
            to={`/deals/${row.original.id}`}
            className="font-medium text-[var(--ink)] underline-offset-4 hover:text-[var(--brass)] hover:underline"
          >
            {row.original.name}
          </Link>
        ),
      },
      {
        id: 'investment_type',
        accessorFn: (deal) => deal.investment_type,
        header: 'Type',
        cell: ({ row }) => (
          <InvestmentChip
            type={row.original.investment_type}
            category={row.original.investment_category}
          />
        ),
      },
      {
        id: 'pipeline_status',
        accessorFn: (deal) => deal.pipeline_status,
        header: 'Stage',
        cell: ({ row }) => <PipelineBadge status={row.original.pipeline_status} showStage />,
      },
      {
        id: 'syndication_status',
        accessorFn: (deal) => deal.syndication_status,
        header: 'Syndication',
        cell: ({ row }) =>
          row.original.syndication_status === 'not_started' ? (
            <span className="text-[var(--slate)]/60">—</span>
          ) : (
            <SyndicationBadge status={row.original.syndication_status} />
          ),
      },
      {
        id: 'sponsor',
        accessorFn: (deal) => deal.sponsor_detail?.entity_name ?? '',
        header: 'Sponsor',
        cell: ({ row }) => (
          <span className="text-[var(--ink-muted)]">
            {row.original.sponsor_detail?.entity_name ?? '—'}
          </span>
        ),
      },
      {
        id: 'requested_amount',
        accessorFn: (deal) => Number(deal.requested_amount) || 0,
        header: 'Requested',
        meta: { align: 'right' as const },
        cell: ({ row }) => (
          <span className="font-medium tabular-nums text-[var(--ink)]">
            {formatCurrency(row.original.requested_amount)}
          </span>
        ),
      },
      {
        id: 'source_channel',
        accessorFn: (deal) => deal.source_channel,
        header: 'Source',
        cell: ({ row }) => (
          <span className="text-[var(--slate)]">
            {SOURCE_CHANNEL_LABELS[row.original.source_channel]}
          </span>
        ),
      },
      {
        id: 'source_date',
        accessorFn: (deal) => new Date(deal.source_date).getTime(),
        header: 'Sourced',
        meta: { align: 'right' as const },
        cell: ({ row }) => (
          <span className="tabular-nums text-[var(--slate)]">
            {formatDate(row.original.source_date)}
          </span>
        ),
      },
    ],
    [],
  );

  const table = useReactTable({
    data: deals,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="overflow-x-auto rounded-md border border-[var(--border)] bg-[var(--paper-elevated)]">
      <table className="w-full min-w-[820px] border-collapse text-sm">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="border-b border-[var(--border)]">
              {headerGroup.headers.map((header) => {
                const align = header.column.columnDef.meta?.align;
                const sort = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    scope="col"
                    className={cn(
                      'px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--slate)]',
                      align === 'right' ? 'text-right' : 'text-left',
                    )}
                  >
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className={cn(
                        'inline-flex items-center gap-1.5 transition-colors hover:text-[var(--ink)]',
                        align === 'right' && 'flex-row-reverse',
                      )}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {sort === 'asc' ? (
                        <ArrowUp className="h-3 w-3" strokeWidth={2} />
                      ) : sort === 'desc' ? (
                        <ArrowDown className="h-3 w-3" strokeWidth={2} />
                      ) : (
                        <ChevronsUpDown className="h-3 w-3 text-[var(--slate)]/50" strokeWidth={2} />
                      )}
                    </button>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-[var(--border)] last:border-0 transition-colors hover:bg-[var(--paper)]"
            >
              {row.getVisibleCells().map((cell) => {
                const align = cell.column.columnDef.meta?.align;
                return (
                  <td
                    key={cell.id}
                    className={cn('px-4 py-3 align-middle', align === 'right' && 'text-right')}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
