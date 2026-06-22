import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectNativeProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
  placeholder?: string;
}

/**
 * A styled native <select>. Read-only filter surfaces don't need a custom popover;
 * the native control keeps keyboard and mobile behavior correct for free.
 */
export const SelectNative = forwardRef<HTMLSelectElement, SelectNativeProps>(
  ({ className, options, placeholder, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={cn(
          'h-9 w-full appearance-none rounded-sm border border-[var(--border)] bg-[var(--paper-elevated)] pl-3 pr-8 text-sm text-[var(--ink)] transition-colors',
          'focus-visible:border-[var(--brass)]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brass)]/20',
          'hover:border-[var(--brass)]/40',
          className,
        )}
        {...props}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--slate)]"
        strokeWidth={1.75}
      />
    </div>
  ),
);
SelectNative.displayName = 'SelectNative';
