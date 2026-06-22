import { cn } from '@/lib/utils';

interface ModeToggleProps<T extends string> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  'aria-label'?: string;
}

/** Small segmented control used to pick "existing vs new" inside the deal form. */
export function ModeToggle<T extends string>({
  value,
  options,
  onChange,
  'aria-label': ariaLabel,
}: ModeToggleProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="inline-flex rounded-sm border border-[var(--border)] bg-[var(--paper)] p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            'rounded-[3px] px-3 py-1 text-xs font-medium transition-colors',
            value === option.value
              ? 'bg-[var(--paper-elevated)] text-[var(--ink)] shadow-[0_1px_2px_rgba(20,24,32,0.08)]'
              : 'text-[var(--slate)] hover:text-[var(--ink)]',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
