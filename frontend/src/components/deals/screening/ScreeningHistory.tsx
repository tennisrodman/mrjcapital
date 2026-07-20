import { Badge } from '@/components/ui/badge';
import { formatDateTime } from '@/lib/dealChoices';
import { cn } from '@/lib/utils';
import type { ScreeningAssessment } from '@/types/screening';

const DECISION_LABELS: Record<ScreeningAssessment['decision'], string> = {
  '': 'Undecided',
  advance: 'Advance',
  refer: 'Refer',
  decline: 'Decline',
};

function ordered(assessments: ScreeningAssessment[]): ScreeningAssessment[] {
  return [...assessments].sort((a, b) => {
    if (a.version !== b.version) return b.version - a.version;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
}

export function ScreeningHistory({
  assessments,
  currentId,
}: {
  assessments: ScreeningAssessment[];
  currentId?: string;
}) {
  if (assessments.length === 0) {
    return <p className="text-sm text-[var(--slate)]">No assessment saved yet. Your first save creates v1.</p>;
  }

  return (
    <ol className="space-y-2" aria-label="Screening assessment version history">
      {ordered(assessments).map((assessment) => {
        const current = assessment.id === currentId;
        return (
          <li
            key={assessment.id}
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
                v{assessment.version}
                {current ? <span className="ml-1.5 text-xs font-normal text-[var(--brass)]">Current</span> : null}
              </p>
              <Badge
                className={
                  assessment.status === 'finalized'
                    ? 'border-[var(--brass)]/35 bg-[var(--brass)]/15 text-[var(--ink)]'
                    : 'border-[var(--border)] bg-[var(--paper-elevated)] text-[var(--slate)]'
                }
              >
                {assessment.status === 'finalized' ? 'Finalized' : 'Draft'}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-[var(--slate)]">
              {DECISION_LABELS[assessment.decision]} · {formatDateTime(assessment.updated_at)}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
