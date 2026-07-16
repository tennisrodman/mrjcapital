import { getDemoIsStaff, setDemoStaff, USE_MOCKS } from '@/config/flags';
import { cn } from '@/lib/utils';

interface DemoStaffToggleProps {
  className?: string;
  surface?: 'dark' | 'light';
}

const TOOLTIP =
  'Demo persona only. Analyst matches typical permissions; Staff unlocks overrides and relationship corrections.';

const DemoStaffToggle = ({ className, surface = 'dark' }: DemoStaffToggleProps) => {
  if (!USE_MOCKS) return null;

  const isLight = surface === 'light';
  const isStaff = getDemoIsStaff();
  const modes = [
    { value: false, label: 'Analyst' },
    { value: true, label: 'Staff' },
  ] as const;

  return (
    <div
      className={cn(
        'inline-flex shrink-0 items-center rounded-sm border p-0.5 text-xs font-semibold',
        isLight
          ? 'border-[var(--border)] bg-white shadow-sm'
          : 'border-white/10 bg-white/5',
        className,
      )}
      aria-label="Demo persona"
      title={TOOLTIP}
    >
      {modes.map((mode) => {
        const active = isStaff === mode.value;
        return (
          <button
            key={mode.label}
            type="button"
            aria-pressed={active}
            onClick={() => {
              if (isStaff !== mode.value) setDemoStaff(mode.value);
            }}
            className={cn(
              'min-w-12 rounded-sm px-2.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brass)]/50',
              active && (isLight ? 'bg-[var(--ink)] text-[var(--paper)] shadow-sm' : 'bg-white/15 text-[var(--header-fg)]'),
              !active && isLight && 'text-[var(--slate)] hover:bg-[var(--paper)] hover:text-[var(--ink)]',
              !active && !isLight && 'text-[var(--header-muted)] hover:bg-white/8 hover:text-[var(--header-fg)]',
            )}
          >
            {mode.label}
          </button>
        );
      })}
    </div>
  );
};

export default DemoStaffToggle;
