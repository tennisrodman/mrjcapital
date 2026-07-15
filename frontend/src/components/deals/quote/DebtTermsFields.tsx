import { FormField } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNative } from '@/components/ui/select-native';
import { Textarea } from '@/components/ui/textarea';
import { formatCurrency } from '@/lib/dealChoices';
import type { QuoteFormValues } from '@/types/quote';

const RATE_TYPE_OPTIONS = [
  { value: '', label: 'Select rate type' },
  { value: 'fixed', label: 'Fixed' },
  { value: 'floating', label: 'Floating' },
  { value: 'hybrid', label: 'Hybrid' },
];

const AMORTIZATION_OPTIONS = [
  { value: '', label: 'Select amortization' },
  { value: 'interest_only', label: 'Interest only' },
  { value: 'partial_amort', label: 'Partial amort' },
  { value: 'full_amort', label: 'Full amort' },
];

const RECOURSE_OPTIONS = [
  { value: '', label: 'Select recourse' },
  { value: 'full', label: 'Full' },
  { value: 'limited', label: 'Limited' },
  { value: 'non_recourse', label: 'Non-recourse with carveouts' },
];

type DebtField = keyof Pick<
  QuoteFormValues,
  | 'loan_amount'
  | 'rate_type'
  | 'interest_rate'
  | 'index_name'
  | 'spread'
  | 'rate_floor'
  | 'term_months'
  | 'amortization_type'
  | 'amortization_months'
  | 'origination_fee_pct'
  | 'exit_fee_pct'
  | 'holdback_amount'
  | 'good_faith_deposit'
  | 'min_dscr'
  | 'max_ltv'
  | 'min_debt_yield'
  | 'prepayment_terms'
  | 'recourse_type'
  | 'recourse_carveouts'
  | 'notes'
>;

interface DebtTermsFieldsProps {
  values: QuoteFormValues;
  onChange: (field: DebtField, value: string) => void;
  disabled?: boolean;
  originationFeeAmount?: string | null;
  initialFundingAmount?: string | null;
}

function MoneyInput({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--slate)]">
        $
      </span>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        placeholder="0.00"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="pl-6 tabular-nums"
      />
    </div>
  );
}

function PercentInput({
  id,
  value,
  disabled,
  onChange,
}: {
  id: string;
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        placeholder="0.00"
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="pr-8 tabular-nums"
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--slate)]">
        %
      </span>
    </div>
  );
}

export function DebtTermsFields({
  values,
  onChange,
  disabled = false,
  originationFeeAmount,
  initialFundingAmount,
}: DebtTermsFieldsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField label="Loan amount" htmlFor="quote-loan-amount">
        <MoneyInput
          id="quote-loan-amount"
          value={values.loan_amount}
          disabled={disabled}
          onChange={(value) => onChange('loan_amount', value)}
        />
      </FormField>

      <FormField label="Rate type" htmlFor="quote-rate-type">
        <SelectNative
          id="quote-rate-type"
          value={values.rate_type}
          disabled={disabled}
          options={RATE_TYPE_OPTIONS}
          onChange={(event) => onChange('rate_type', event.target.value)}
        />
      </FormField>

      <FormField label="Interest rate" htmlFor="quote-interest-rate">
        <PercentInput
          id="quote-interest-rate"
          value={values.interest_rate}
          disabled={disabled}
          onChange={(value) => onChange('interest_rate', value)}
        />
      </FormField>

      <FormField label="Index" htmlFor="quote-index-name" hint="For floating or hybrid rates.">
        <Input
          id="quote-index-name"
          value={values.index_name}
          disabled={disabled}
          placeholder="SOFR"
          onChange={(event) => onChange('index_name', event.target.value)}
        />
      </FormField>

      <FormField label="Spread" htmlFor="quote-spread">
        <PercentInput
          id="quote-spread"
          value={values.spread}
          disabled={disabled}
          onChange={(value) => onChange('spread', value)}
        />
      </FormField>

      <FormField label="Rate floor" htmlFor="quote-rate-floor">
        <PercentInput
          id="quote-rate-floor"
          value={values.rate_floor}
          disabled={disabled}
          onChange={(value) => onChange('rate_floor', value)}
        />
      </FormField>

      <FormField label="Term" htmlFor="quote-term-months">
        <div className="relative">
          <Input
            id="quote-term-months"
            type="text"
            inputMode="numeric"
            placeholder="24"
            disabled={disabled}
            value={values.term_months}
            onChange={(event) => onChange('term_months', event.target.value)}
            className="pr-10 tabular-nums"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--slate)]">
            mo
          </span>
        </div>
      </FormField>

      <FormField label="Amortization type" htmlFor="quote-amortization-type">
        <SelectNative
          id="quote-amortization-type"
          value={values.amortization_type}
          disabled={disabled}
          options={AMORTIZATION_OPTIONS}
          onChange={(event) => onChange('amortization_type', event.target.value)}
        />
      </FormField>

      <FormField label="Amortization period" htmlFor="quote-amortization-months">
        <div className="relative">
          <Input
            id="quote-amortization-months"
            type="text"
            inputMode="numeric"
            placeholder="360"
            disabled={disabled}
            value={values.amortization_months}
            onChange={(event) => onChange('amortization_months', event.target.value)}
            className="pr-10 tabular-nums"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--slate)]">
            mo
          </span>
        </div>
      </FormField>

      <FormField label="Origination fee" htmlFor="quote-origination-fee-pct">
        <PercentInput
          id="quote-origination-fee-pct"
          value={values.origination_fee_pct}
          disabled={disabled}
          onChange={(value) => onChange('origination_fee_pct', value)}
        />
      </FormField>

      {originationFeeAmount != null && originationFeeAmount !== '' ? (
        <FormField label="Origination fee amount" htmlFor="quote-origination-fee-amount">
          <Input
            id="quote-origination-fee-amount"
            value={formatCurrency(originationFeeAmount)}
            readOnly
            disabled
            className="tabular-nums"
          />
        </FormField>
      ) : null}

      <FormField label="Exit fee" htmlFor="quote-exit-fee-pct">
        <PercentInput
          id="quote-exit-fee-pct"
          value={values.exit_fee_pct}
          disabled={disabled}
          onChange={(value) => onChange('exit_fee_pct', value)}
        />
      </FormField>

      <FormField label="Holdback" htmlFor="quote-holdback-amount">
        <MoneyInput
          id="quote-holdback-amount"
          value={values.holdback_amount}
          disabled={disabled}
          onChange={(value) => onChange('holdback_amount', value)}
        />
      </FormField>

      {initialFundingAmount != null && initialFundingAmount !== '' ? (
        <FormField label="Initial funding" htmlFor="quote-initial-funding-amount">
          <Input
            id="quote-initial-funding-amount"
            value={formatCurrency(initialFundingAmount)}
            readOnly
            disabled
            className="tabular-nums"
          />
        </FormField>
      ) : null}

      <FormField label="Good faith deposit" htmlFor="quote-good-faith-deposit">
        <MoneyInput
          id="quote-good-faith-deposit"
          value={values.good_faith_deposit}
          disabled={disabled}
          onChange={(value) => onChange('good_faith_deposit', value)}
        />
      </FormField>

      <FormField label="Min DSCR" htmlFor="quote-min-dscr">
        <Input
          id="quote-min-dscr"
          type="text"
          inputMode="decimal"
          placeholder="1.20"
          disabled={disabled}
          value={values.min_dscr}
          onChange={(event) => onChange('min_dscr', event.target.value)}
          className="tabular-nums"
        />
      </FormField>

      <FormField label="Max LTV" htmlFor="quote-max-ltv" hint="Fractional: 0.65 = 65%.">
        <Input
          id="quote-max-ltv"
          type="text"
          inputMode="decimal"
          placeholder="0.65"
          disabled={disabled}
          value={values.max_ltv}
          onChange={(event) => onChange('max_ltv', event.target.value)}
          className="tabular-nums"
        />
      </FormField>

      <FormField label="Min debt yield" htmlFor="quote-min-debt-yield" hint="Fractional: 0.08 = 8%.">
        <Input
          id="quote-min-debt-yield"
          type="text"
          inputMode="decimal"
          placeholder="0.08"
          disabled={disabled}
          value={values.min_debt_yield}
          onChange={(event) => onChange('min_debt_yield', event.target.value)}
          className="tabular-nums"
        />
      </FormField>

      <FormField label="Recourse type" htmlFor="quote-recourse-type">
        <SelectNative
          id="quote-recourse-type"
          value={values.recourse_type}
          disabled={disabled}
          options={RECOURSE_OPTIONS}
          onChange={(event) => onChange('recourse_type', event.target.value)}
        />
      </FormField>

      <FormField
        label="Prepayment terms"
        htmlFor="quote-prepayment-terms"
        className="sm:col-span-2"
      >
        <Textarea
          id="quote-prepayment-terms"
          disabled={disabled}
          rows={2}
          placeholder="Lockout, yield maintenance, or open prepay…"
          value={values.prepayment_terms}
          onChange={(event) => onChange('prepayment_terms', event.target.value)}
        />
      </FormField>

      <FormField
        label="Recourse carveouts"
        htmlFor="quote-recourse-carveouts"
        className="sm:col-span-2"
      >
        <Textarea
          id="quote-recourse-carveouts"
          disabled={disabled}
          rows={2}
          placeholder="Bad-boy acts, environmental, fraud…"
          value={values.recourse_carveouts}
          onChange={(event) => onChange('recourse_carveouts', event.target.value)}
        />
      </FormField>

      <FormField label="Notes" htmlFor="quote-notes" className="sm:col-span-2">
        <Textarea
          id="quote-notes"
          disabled={disabled}
          rows={3}
          placeholder="Internal quote context and open points…"
          value={values.notes}
          onChange={(event) => onChange('notes', event.target.value)}
        />
      </FormField>
    </div>
  );
}
