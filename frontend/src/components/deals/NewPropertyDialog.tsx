import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Plus, X } from 'lucide-react';

import { PROPERTY_TYPE_OPTIONS, STATE_OPTIONS } from '@/components/deals/form/options';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNative } from '@/components/ui/select-native';
import { useCreateProperty, type PropertyInput } from '@/lib/api/deals';
import { apiErrorMessage } from '@/lib/apiError';
import type { Property } from '@/types/deal';

export function NewPropertyDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (property: Property) => void;
}) {
  const createProperty = useCreateProperty();
  const [values, setValues] = useState({
    address: '', city: '', state: '', zip: '', property_type: '', subtype: '', units: '', rentable_square_feet: '',
  });
  const [error, setError] = useState<string | null>(null);
  const field = (name: keyof typeof values, value: string) =>
    setValues((current) => ({ ...current, [name]: value }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!values.address.trim() || !values.city.trim() || !values.state || !values.zip.trim() || !values.property_type) {
      setError('Address, city, state, ZIP, and property type are required.');
      return;
    }
    const payload: PropertyInput = {
      address: values.address.trim(),
      city: values.city.trim(),
      state: values.state,
      zip: values.zip.trim(),
      property_type: values.property_type as Property['property_type'],
      ...(values.subtype.trim() ? { subtype: values.subtype.trim() } : {}),
      ...(values.units ? { units: Number(values.units) } : {}),
      ...(values.rentable_square_feet ? { rentable_square_feet: Number(values.rentable_square_feet) } : {}),
    };
    createProperty.mutate(payload, {
      onSuccess: (property) => {
        onCreated(property);
        onOpenChange(false);
        setValues({ address: '', city: '', state: '', zip: '', property_type: '', subtype: '', units: '', rentable_square_feet: '' });
      },
      onError: (requestError) => setError(apiErrorMessage(requestError)),
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[var(--ink)]/40 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--paper-elevated)] p-6 shadow-2xl focus:outline-none">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="font-display text-lg font-medium text-[var(--ink)]">Register property</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-[var(--slate)]">
                Create a new collateral record and attach it to this deal.
              </Dialog.Description>
            </div>
            <Dialog.Close aria-label="Close new property dialog" className="rounded-sm p-1 text-[var(--slate)] hover:text-[var(--ink)]"><X className="h-4 w-4" /></Dialog.Close>
          </div>
          <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={submit}>
            <FormField label="Street address" required className="sm:col-span-2"><Input value={values.address} onChange={(event) => field('address', event.target.value)} /></FormField>
            <FormField label="City" required><Input value={values.city} onChange={(event) => field('city', event.target.value)} /></FormField>
            <div className="grid grid-cols-2 gap-4">
              <FormField label="State" required><SelectNative placeholder="—" options={STATE_OPTIONS} value={values.state} onChange={(event) => field('state', event.target.value)} /></FormField>
              <FormField label="ZIP" required><Input value={values.zip} onChange={(event) => field('zip', event.target.value)} /></FormField>
            </div>
            <FormField label="Property type" required><SelectNative placeholder="Select type" options={PROPERTY_TYPE_OPTIONS} value={values.property_type} onChange={(event) => field('property_type', event.target.value)} /></FormField>
            <FormField label="Subtype" hint="Optional"><Input value={values.subtype} onChange={(event) => field('subtype', event.target.value)} /></FormField>
            <FormField label="Units / keys" hint="Optional"><Input type="number" min="0" step="1" value={values.units} onChange={(event) => field('units', event.target.value)} /></FormField>
            <FormField label="Rentable square feet" hint="Optional"><Input type="number" min="0" step="1" value={values.rentable_square_feet} onChange={(event) => field('rentable_square_feet', event.target.value)} /></FormField>
            {error ? <p role="alert" className="text-sm text-red-600 sm:col-span-2">{error}</p> : null}
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={createProperty.isPending}><Plus className="h-4 w-4" />{createProperty.isPending ? 'Creating…' : 'Create and attach'}</Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
