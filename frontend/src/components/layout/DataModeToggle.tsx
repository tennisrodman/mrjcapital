import { DATA_MODE, setDataMode, type DataMode } from '@/config/flags';
import { cn } from '@/lib/utils';

const modes: { value: DataMode; label: string }[] = [
  { value: 'live', label: 'Live' },
  { value: 'mock', label: 'Demo' },
];

interface DataModeToggleProps {
  className?: string;
  surface?: 'dark' | 'light';
}

const TOOLTIP = 'Switch data source. Your Live session is restored when available.';

const DataModeToggle = ({ className, surface = 'dark' }: DataModeToggleProps) => {
  const isLight = surface === 'light';

  return (
    <div
      className={cn(
        'inline-flex shrink-0 items-center rounded-sm border p-0.5 text-xs font-semibold',
        isLight
          ? 'border-[var(--border)] bg-white shadow-sm'
          : 'border-white/10 bg-white/5',
        className,
      )}
      aria-label="Data mode"
      title={TOOLTIP}
    >
      {modes.map((mode) => {
        const active = DATA_MODE === mode.value;
        const demo = mode.value === 'mock';
        return (
          <button
            key={mode.value}
            type="button"
            aria-pressed={active}
            onClick={() => setDataMode(mode.value)}
            className={cn(
              'min-w-12 rounded-sm px-2.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brass)]/50',
              active && demo && 'bg-[var(--brass)] text-white shadow-sm',
              active && !demo && (isLight ? 'bg-[var(--ink)] text-[var(--paper)] shadow-sm' : 'bg-white/15 text-[var(--header-fg)]'),
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

export default DataModeToggle;
