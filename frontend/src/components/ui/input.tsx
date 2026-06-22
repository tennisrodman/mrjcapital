import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const inputClass =
  'h-9 w-full rounded-sm border border-[var(--border)] bg-[var(--paper-elevated)] px-3 text-sm text-[var(--ink)] transition-colors placeholder:text-[var(--slate)]/60 hover:border-[var(--brass)]/40 focus-visible:border-[var(--brass)]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brass)]/20 aria-[invalid=true]:border-red-400 aria-[invalid=true]:focus-visible:ring-red-200';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(inputClass, className)} {...props} />
  ),
);
Input.displayName = 'Input';
