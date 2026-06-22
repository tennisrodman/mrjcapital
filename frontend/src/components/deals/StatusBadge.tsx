import { Badge } from '@/components/ui/badge';
import {
  INVESTMENT_CATEGORY_LABELS,
  INVESTMENT_TYPE_LABELS,
  PIPELINE_STATUS_LABELS,
  SYNDICATION_STATUS_LABELS,
  pipelineBadgeClass,
  pipelineStageNumber,
  syndicationBadgeClass,
} from '@/lib/dealChoices';
import { cn } from '@/lib/utils';
import type {
  InvestmentCategory,
  InvestmentType,
  PipelineStatus,
  SyndicationStatus,
} from '@/types/deal';

export function PipelineBadge({
  status,
  showStage = false,
}: {
  status: PipelineStatus;
  showStage?: boolean;
}) {
  const stage = pipelineStageNumber(status);
  return (
    <Badge className={pipelineBadgeClass(status)}>
      {showStage && stage !== null ? (
        <span className="font-display text-[0.7em] tabular-nums opacity-60">{stage}</span>
      ) : null}
      {PIPELINE_STATUS_LABELS[status]}
    </Badge>
  );
}

export function SyndicationBadge({
  status,
  hideNotStarted = false,
}: {
  status: SyndicationStatus;
  hideNotStarted?: boolean;
}) {
  if (hideNotStarted && status === 'not_started') return null;
  return (
    <Badge className={syndicationBadgeClass(status)}>{SYNDICATION_STATUS_LABELS[status]}</Badge>
  );
}

/** Investment type with a quiet category prefix dot (debt / hybrid / equity). */
export function InvestmentChip({
  type,
  category,
  className,
}: {
  type: InvestmentType;
  category?: InvestmentCategory;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-medium text-[var(--ink-muted)]',
        className,
      )}
    >
      {category ? (
        <span
          className="h-1.5 w-1.5 rounded-full bg-[var(--brass)]"
          title={INVESTMENT_CATEGORY_LABELS[category]}
          aria-hidden
        />
      ) : null}
      {INVESTMENT_TYPE_LABELS[type]}
    </span>
  );
}
