import { forwardRef, type TextareaHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'min-h-[80px] w-full rounded-sm border border-[var(--border)] bg-[var(--paper-elevated)] px-3 py-2 text-sm text-[var(--ink)] transition-colors placeholder:text-[var(--slate)]/60 hover:border-[var(--brass)]/40 focus-visible:border-[var(--brass)]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brass)]/20 aria-[invalid=true]:border-red-400',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
