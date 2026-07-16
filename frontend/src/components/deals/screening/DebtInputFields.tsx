import type { FieldErrors, UseFormRegister } from 'react-hook-form';

import { FormField } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNative } from '@/components/ui/select-native';
import { Textarea } from '@/components/ui/textarea';
import type { ScreeningAssessmentFormValues } from '@/types/screening';
import { isOptionalDecimal, isOptionalPositiveInteger, isPositiveDecimal } from './calculations';

type DebtFieldName =
  | 'loan_amount'
  | 'as_is_value'
  | 'stabilized_value'
  | 'project_cost'
  | 'noi'
  | 'stabilized_noi'
  | 'annual_debt_service'
  | 'occupancy'
  | 'proposed_rate'
  | 'proposed_term_months'
  | 'current_average_rent'
  | 'market_rent'
  | 'exit_cap_rate';

interface DecimalFieldProps {
  name: DebtFieldName;
  label: string;
  hint?: string;
  prefix?: string;
  suffix?: string;
  required?: boolean;
  positive?: boolean;
  integer?: boolean;
  disabled?: boolean;
  register: UseFormRegister<ScreeningAssessmentFormValues>;
  errors: FieldErrors<ScreeningAssessmentFormValues>;
}

function DecimalField({
  name,
  label,
  hint,
  prefix,
  suffix,
  required,
  positive,
  integer,
  disabled,
  register,
  errors,
}: DecimalFieldProps) {
  const error = errors[name]?.message;
  const inputId = `screening-${name}`;

  return (
    <FormField label={label} htmlFor={inputId} required={required} hint={hint} error={error}>
      <div className="relative">
        {prefix ? (
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--slate)]">
            {prefix}
          </span>
        ) : null}
        <Input
          id={inputId}
          type="text"
          inputMode="decimal"
          placeholder="0.00"
          disabled={disabled}
          aria-invalid={Boolean(error)}
          className={`${prefix ? 'pl-6' : ''} ${suffix ? 'pr-8' : ''} tabular-nums`}
          {...register(name, {
            validate: (value) => {
              if (required && !value.trim()) return `${label} is required`;
              if (integer && !isOptionalPositiveInteger(value)) return 'Use a positive whole number';
              if (!integer && !isOptionalDecimal(value)) return 'Use a valid decimal amount';
              if (positive && value.trim() && !isPositiveDecimal(value)) {
                return 'Enter an amount greater than zero';
              }
              return true;
            },
          })}
        />
        {suffix ? (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--slate)]">
            {suffix}
          </span>
        ) : null}
      </div>
    </FormField>
  );
}

export function DebtInputFields({
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
      <DecimalField
        name="loan_amount"
        label="Proposed debt"
        hint="The requested or contemplated senior debt."
        prefix="$"
        required
        positive
        disabled={disabled}
        register={register}
        errors={errors}
      />
      <DecimalField
        name="as_is_value"
        label="As-is value"
        hint="Current value before the business plan."
        prefix="$"
        positive
        disabled={disabled}
        register={register}
        errors={errors}
      />
      <DecimalField
        name="stabilized_value"
        label="Stabilized value"
        hint="Value at the expected stabilized state."
        prefix="$"
        positive
        disabled={disabled}
        register={register}
        errors={errors}
      />
      <DecimalField
        name="project_cost"
        label="Total cost"
        hint="Purchase, capital plan, and other basis."
        prefix="$"
        positive
        disabled={disabled}
        register={register}
        errors={errors}
      />
      <DecimalField
        name="noi"
        label="Current annual NOI"
        hint="In-place NOI used for current coverage."
        prefix="$"
        positive
        disabled={disabled}
        register={register}
        errors={errors}
      />
      <DecimalField
        name="stabilized_noi"
        label="Stabilized annual NOI"
        hint="Required before an Advance decision."
        prefix="$"
        positive
        disabled={disabled}
        register={register}
        errors={errors}
      />
      <DecimalField
        name="annual_debt_service"
        label="Annual debt service"
        hint="Annual principal and interest obligation."
        prefix="$"
        positive
        disabled={disabled}
        register={register}
        errors={errors}
      />
      <DecimalField
        name="occupancy"
        label="Occupancy"
        hint="Current physical occupancy, from 0 through 100."
        suffix="%"
        disabled={disabled}
        register={register}
        errors={errors}
      />
      <DecimalField
        name="proposed_rate"
        label="Interest rate"
        hint="For context; it does not replace debt service."
        suffix="%"
        positive
        disabled={disabled}
        register={register}
        errors={errors}
      />
      <DecimalField
        name="proposed_term_months"
        label="Proposed term"
        hint="Loan term in whole months."
        suffix="mo"
        integer
        positive
        disabled={disabled}
        register={register}
        errors={errors}
      />
      <DecimalField
        name="current_average_rent"
        label="Current average rent"
        hint="Per unit or comparable collateral measure · optional."
        prefix="$"
        positive
        disabled={disabled}
        register={register}
        errors={errors}
      />
      <DecimalField
        name="market_rent"
        label="Market rent"
        hint="Per unit or comparable collateral measure · optional."
        prefix="$"
        positive
        disabled={disabled}
        register={register}
        errors={errors}
      />
      <DecimalField
        name="exit_cap_rate"
        label="Exit cap rate"
        hint="Required before an Advance decision."
        suffix="%"
        positive
        disabled={disabled}
        register={register}
        errors={errors}
      />
      <FormField label="Property condition" hint="Optional">
        <SelectNative
          placeholder="Not assessed"
          options={[
            { value: 'poor', label: 'Poor' },
            { value: 'fair', label: 'Fair' },
            { value: 'good', label: 'Good' },
            { value: 'excellent', label: 'Excellent' },
          ]}
          disabled={disabled}
          {...register('condition_rating')}
        />
      </FormField>
      <FormField label="Unit / collateral mix" hint="Optional" className="sm:col-span-2">
        <Textarea
          rows={3}
          disabled={disabled}
          placeholder="Example: 40 one-bedroom and 24 two-bedroom units"
          {...register('unit_mix')}
        />
      </FormField>
      <FormField
        label="Exit strategy"
        hint="Required before an Advance decision."
        className="sm:col-span-2"
      >
        <Textarea
          rows={3}
          disabled={disabled}
          placeholder="Describe repayment, refinance, or sale assumptions."
          {...register('exit_strategy')}
        />
      </FormField>
    </div>
  );
}
