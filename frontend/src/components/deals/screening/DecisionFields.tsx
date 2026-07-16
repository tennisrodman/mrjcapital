import type { FieldErrors, UseFormRegister } from 'react-hook-form';

import { FormField } from '@/components/ui/field';
import { SelectNative } from '@/components/ui/select-native';
import { Textarea } from '@/components/ui/textarea';
import type { ScreeningAssessmentFormValues } from '@/types/screening';

const DECISION_OPTIONS = [
  { value: '', label: 'Select a decision' },
  { value: 'advance', label: 'Advance' },
  { value: 'refer', label: 'Refer for review' },
  { value: 'decline', label: 'Decline' },
];

export function DecisionFields({
  register,
  errors,
  disabled = false,
}: {
  register: UseFormRegister<ScreeningAssessmentFormValues>;
  errors: FieldErrors<ScreeningAssessmentFormValues>;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField label="Screening decision" htmlFor="screening-decision" error={errors.decision?.message}>
        <SelectNative
          id="screening-decision"
          options={DECISION_OPTIONS}
          disabled={disabled}
          aria-invalid={Boolean(errors.decision)}
          {...register('decision')}
        />
      </FormField>
      <FormField
        label="Underwriting notes"
        htmlFor="screening-notes"
        error={errors.notes?.message}
        className="sm:col-span-2"
      >
        <Textarea
          id="screening-notes"
          disabled={disabled}
          placeholder="Key risks, open diligence items, and rationale…"
          aria-invalid={Boolean(errors.notes)}
          {...register('notes')}
        />
      </FormField>
    </div>
  );
}
