import { FormField } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { QuoteFormValues } from '@/types/quote';

type EquityField = keyof Pick<
  QuoteFormValues,
  'equity_commitment' | 'ownership_pct' | 'preferred_return_pct' | 'equity_summary'
>;

interface EquitySummaryFieldsProps {
  values: QuoteFormValues;
  onChange: (field: EquityField, value: string) => void;
  disabled?: boolean;
}

export function EquitySummaryFields({
  values,
  onChange,
  disabled = false,
}: EquitySummaryFieldsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FormField label="Equity commitment" htmlFor="quote-equity-commitment">
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--slate)]">
            $
          </span>
          <Input
            id="quote-equity-commitment"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            disabled={disabled}
            value={values.equity_commitment}
            onChange={(event) => onChange('equity_commitment', event.target.value)}
            className="pl-6 tabular-nums"
          />
        </div>
      </FormField>

      <FormField label="Ownership" htmlFor="quote-ownership-pct">
        <div className="relative">
          <Input
            id="quote-ownership-pct"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            disabled={disabled}
            value={values.ownership_pct}
            onChange={(event) => onChange('ownership_pct', event.target.value)}
            className="pr-8 tabular-nums"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--slate)]">
            %
          </span>
        </div>
      </FormField>

      <FormField label="Preferred return" htmlFor="quote-preferred-return-pct">
        <div className="relative">
          <Input
            id="quote-preferred-return-pct"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            disabled={disabled}
            value={values.preferred_return_pct}
            onChange={(event) => onChange('preferred_return_pct', event.target.value)}
            className="pr-8 tabular-nums"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[var(--slate)]">
            %
          </span>
        </div>
      </FormField>

      <FormField
        label="Equity summary"
        htmlFor="quote-equity-summary"
        hint="Optional narrative — no equity model is calculated here."
        className="sm:col-span-2"
      >
        <Textarea
          id="quote-equity-summary"
          disabled={disabled}
          rows={3}
          placeholder="Co-invest, promote, or preferred equity context…"
          value={values.equity_summary}
          onChange={(event) => onChange('equity_summary', event.target.value)}
        />
      </FormField>
    </div>
  );
}
