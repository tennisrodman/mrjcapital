import {
  Children,
  createContext,
  isValidElement,
  useContext,
  useId,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';

interface FormFieldControlContextValue {
  controlId: string;
  describedBy?: string;
}

const FormFieldControlContext = createContext<FormFieldControlContextValue | null>(null);

function findExplicitControlId(children: ReactNode): string | undefined {
  let controlId: string | undefined;
  Children.forEach(children, (child) => {
    if (controlId || !isValidElement(child)) return;
    const element = child as ReactElement<{ id?: unknown; children?: ReactNode }>;
    if (typeof element.props.id === 'string' && element.props.id) {
      controlId = element.props.id;
      return;
    }
    controlId = findExplicitControlId(element.props.children);
  });
  return controlId;
}

export function useFormFieldControl({
  id,
  describedBy,
}: {
  id?: string;
  describedBy?: string;
}): { id?: string; 'aria-describedby'?: string } {
  const field = useContext(FormFieldControlContext);
  if (!field) return { id, 'aria-describedby': describedBy };

  const descriptions = [...(describedBy?.split(/\s+/) ?? []), ...(field.describedBy?.split(/\s+/) ?? [])]
    .filter(Boolean);
  return {
    id: id ?? field.controlId,
    'aria-describedby': descriptions.length ? [...new Set(descriptions)].join(' ') : undefined,
  };
}

export function Label({
  htmlFor,
  children,
  required,
  className,
}: {
  htmlFor?: string;
  children: ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className={cn('text-sm font-medium text-[var(--ink)]', className)}
    >
      {children}
      {required ? <span className="ml-0.5 text-[var(--brass)]">*</span> : null}
    </label>
  );
}

export function FormField({
  label,
  htmlFor,
  required,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  const generatedId = useId();
  const helperId = error || hint ? `${generatedId}-help` : undefined;
  const controlId = htmlFor ?? findExplicitControlId(children) ?? generatedId;

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={controlId} required={required}>
        {label}
      </Label>
      <FormFieldControlContext.Provider value={{ controlId, describedBy: helperId }}>
        {children}
      </FormFieldControlContext.Provider>
      {error ? (
        <p id={helperId} role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={helperId} className="text-xs text-[var(--slate)]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
