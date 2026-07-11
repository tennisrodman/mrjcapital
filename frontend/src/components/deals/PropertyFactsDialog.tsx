import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Save, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useUpdateProperty, type UpdatePropertyFactsPayload } from '@/lib/api/deals';
import { apiErrorMessage, fieldErrors } from '@/lib/apiError';
import { isOptionalWholeNumber, isOptionalYear, optionalNumber } from '@/lib/formValidation';
import type { Property } from '@/types/deal';

interface PropertyFactsDialogProps {
  property: Property;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type PropertyFactField = keyof UpdatePropertyFactsPayload;
type PropertyFactErrors = Partial<Record<PropertyFactField, string>>;

export function PropertyFactsDialog({ property, open, onOpenChange }: PropertyFactsDialogProps) {
  const updateProperty = useUpdateProperty(property.id);
  const [subtype, setSubtype] = useState('');
  const [units, setUnits] = useState('');
  const [rentableSquareFeet, setRentableSquareFeet] = useState('');
  const [yearBuilt, setYearBuilt] = useState('');
  const [yearRenovated, setYearRenovated] = useState('');
  const [county, setCounty] = useState('');
  const [errors, setErrors] = useState<PropertyFactErrors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const initializedPropertyId = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      initializedPropertyId.current = null;
      return;
    }
    if (initializedPropertyId.current === property.id) return;
    initializedPropertyId.current = property.id;
    setSubtype(property.subtype ?? '');
    setUnits(property.units?.toString() ?? '');
    setRentableSquareFeet(property.rentable_square_feet?.toString() ?? '');
    setYearBuilt(property.year_built?.toString() ?? '');
    setYearRenovated(property.year_renovated?.toString() ?? '');
    setCounty(property.county ?? '');
    setErrors({});
    setBanner(null);
  }, [open, property]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors: PropertyFactErrors = {};
    if (!isOptionalWholeNumber(units)) nextErrors.units = 'Enter zero or a positive whole number';
    if (!isOptionalWholeNumber(rentableSquareFeet)) {
      nextErrors.rentable_square_feet = 'Enter zero or a positive whole number';
    }
    if (!isOptionalYear(yearBuilt)) nextErrors.year_built = 'Enter a year from 1700 to 2200';
    if (!isOptionalYear(yearRenovated)) nextErrors.year_renovated = 'Enter a year from 1700 to 2200';
    const built = optionalNumber(yearBuilt);
    const renovated = optionalNumber(yearRenovated);
    if (built !== null && renovated !== null && renovated < built) {
      nextErrors.year_renovated = 'Year renovated cannot be earlier than year built';
    }
    setErrors(nextErrors);
    setBanner(null);
    if (Object.keys(nextErrors).length) return;

    const payload: UpdatePropertyFactsPayload = {
      subtype: subtype.trim(),
      units: optionalNumber(units),
      rentable_square_feet: optionalNumber(rentableSquareFeet),
      year_built: built,
      year_renovated: renovated,
      county: county.trim(),
    };
    updateProperty.mutate(payload, {
      onSuccess: () => onOpenChange(false),
      onError: (error) => {
        const fields = fieldErrors(error);
        const fieldState: PropertyFactErrors = {
          subtype: fields.subtype,
          units: fields.units,
          rentable_square_feet: fields.rentable_square_feet,
          year_built: fields.year_built,
          year_renovated: fields.year_renovated,
          county: fields.county,
        };
        setErrors(fieldState);
        setBanner(Object.values(fieldState).some(Boolean) ? 'Please fix the highlighted fields.' : apiErrorMessage(error));
      },
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--ink)]/40 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--paper-elevated)] p-6 shadow-2xl focus:outline-none">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Dialog.Title className="font-display text-lg font-medium text-[var(--ink)]">
                Edit property facts
              </Dialog.Title>
              <Dialog.Description className="mt-1 break-words text-sm text-[var(--slate)]">
                Update underwriting facts for {property.address}, {property.city}. Address, type, and deal relationship remain unchanged.
              </Dialog.Description>
            </div>
            <Dialog.Close aria-label="Close property facts dialog" className="rounded-sm p-1 text-[var(--slate)] hover:text-[var(--ink)]">
              <X className="h-4 w-4" strokeWidth={1.75} />
            </Dialog.Close>
          </div>

          <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Subtype" hint="Optional">
                <Input value={subtype} onChange={(event) => setSubtype(event.target.value)} />
              </FormField>
              <FormField label="County" hint="Optional">
                <Input value={county} onChange={(event) => setCounty(event.target.value)} />
              </FormField>
              <FormField label="Units" hint="Optional" error={errors.units}>
                <Input type="number" min="0" step="1" value={units} aria-invalid={Boolean(errors.units)} onChange={(event) => setUnits(event.target.value)} />
              </FormField>
              <FormField label="Rentable square feet" hint="Optional" error={errors.rentable_square_feet}>
                <Input type="number" min="0" step="1" value={rentableSquareFeet} aria-invalid={Boolean(errors.rentable_square_feet)} onChange={(event) => setRentableSquareFeet(event.target.value)} />
              </FormField>
              <FormField label="Year built" hint="Optional" error={errors.year_built}>
                <Input type="number" min="1700" max="2200" step="1" value={yearBuilt} aria-invalid={Boolean(errors.year_built)} onChange={(event) => setYearBuilt(event.target.value)} />
              </FormField>
              <FormField label="Year renovated" hint="Optional" error={errors.year_renovated}>
                <Input type="number" min="1700" max="2200" step="1" value={yearRenovated} aria-invalid={Boolean(errors.year_renovated)} onChange={(event) => setYearRenovated(event.target.value)} />
              </FormField>
            </div>

            {banner ? <p role="alert" className="text-sm text-red-600">{banner}</p> : null}
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={updateProperty.isPending}>
                <Save className="h-4 w-4" strokeWidth={1.75} />
                {updateProperty.isPending ? 'Saving…' : 'Save property facts'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
