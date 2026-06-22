import { Link } from 'react-router-dom';
import { Building2, MapPin } from 'lucide-react';
import { InvestmentChip, SyndicationBadge } from '@/components/deals/StatusBadge';
import { formatCurrencyCompact } from '@/lib/dealChoices';
import type { Deal } from '@/types/deal';

function primaryLocation(deal: Deal): string | null {
  const primary = deal.properties.find((entry) => entry.is_primary) ?? deal.properties[0];
  if (!primary) return null;
  const { city, state } = primary.property;
  return [city, state].filter(Boolean).join(', ') || null;
}

export function DealCard({ deal }: { deal: Deal }) {
  const sponsorName = deal.sponsor_detail?.entity_name ?? 'Sponsor on file';
  const location = primaryLocation(deal);
  const extraProperties = deal.properties.length - 1;

  return (
    <Link
      to={`/deals/${deal.id}`}
      className="group block rounded-md border border-[var(--border)] bg-[var(--paper-elevated)] p-3.5 shadow-[0_1px_0_rgba(20,24,32,0.03)] transition-all hover:-translate-y-0.5 hover:border-[var(--brass)]/40 hover:shadow-[0_4px_16px_rgba(20,24,32,0.08)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brass)]/40"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-display text-[0.95rem] font-medium leading-snug tracking-tight text-[var(--ink)] group-hover:text-[var(--ink)]">
          {deal.name}
        </h3>
        <span className="shrink-0 font-display text-sm font-medium tabular-nums text-[var(--brass)]">
          {formatCurrencyCompact(deal.requested_amount)}
        </span>
      </div>

      <div className="mt-2">
        <InvestmentChip type={deal.investment_type} category={deal.investment_category} />
      </div>

      <dl className="mt-3 space-y-1.5 border-t border-[var(--border)] pt-2.5 text-xs text-[var(--slate)]">
        <div className="flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5 shrink-0 text-[var(--slate)]/70" strokeWidth={1.75} />
          <dd className="truncate">{sponsorName}</dd>
        </div>
        {location ? (
          <div className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 shrink-0 text-[var(--slate)]/70" strokeWidth={1.75} />
            <dd className="truncate">
              {location}
              {extraProperties > 0 ? (
                <span className="text-[var(--slate)]/70"> +{extraProperties} more</span>
              ) : null}
            </dd>
          </div>
        ) : null}
      </dl>

      {deal.syndication_status !== 'not_started' ? (
        <div className="mt-2.5">
          <SyndicationBadge status={deal.syndication_status} />
        </div>
      ) : null}
    </Link>
  );
}
