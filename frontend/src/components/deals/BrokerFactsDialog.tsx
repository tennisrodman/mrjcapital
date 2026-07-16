import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Save, X } from 'lucide-react';

import { BROKER_COMMISSION_TYPE_OPTIONS } from '@/components/deals/form/options';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNative } from '@/components/ui/select-native';
import { useUpdateBroker, type UpdateBrokerFactsPayload } from '@/lib/api/deals';
import { apiErrorMessage } from '@/lib/apiError';
import type { Broker } from '@/types/deal';

interface BrokerFactsDialogProps {
  broker: Broker;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'blocked', label: 'Blocked' },
];

export function BrokerFactsDialog({ broker, open, onOpenChange }: BrokerFactsDialogProps) {
  const updateBroker = useUpdateBroker(broker.id);
  const [values, setValues] = useState({
    company_name: '',
    contact_name: '',
    email: '',
    phone: '',
    status: 'active' as Broker['status'],
    default_commission_rate: '',
    commission_type: '' as Broker['commission_type'],
    preferred_deal_types: '',
    geographic_focus: '',
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setValues({
      company_name: broker.company_name,
      contact_name: broker.contact_name,
      email: broker.email,
      phone: broker.phone ?? '',
      status: broker.status,
      default_commission_rate: broker.default_commission_rate ?? '',
      commission_type: broker.commission_type ?? '',
      preferred_deal_types: (broker.preferred_deal_types ?? []).join(', '),
      geographic_focus: (broker.geographic_focus ?? []).join(', '),
    });
    setError(null);
  }, [broker, open]);

  const field = (name: keyof typeof values, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!values.company_name.trim() || !values.contact_name.trim()) {
      setError('Company and contact name are required.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
      setError('Enter a valid broker email address.');
      return;
    }
    if (values.default_commission_rate.trim() && !/^\d+(?:\.\d{1,4})?$/.test(values.default_commission_rate.trim())) {
      setError('Commission rate must be nonnegative with no more than 4 decimal places.');
      return;
    }
    const payload: UpdateBrokerFactsPayload = {
      company_name: values.company_name.trim(),
      contact_name: values.contact_name.trim(),
      email: values.email.trim(),
      phone: values.phone.trim(),
      status: values.status,
      default_commission_rate: values.default_commission_rate.trim() || null,
      commission_type: values.commission_type,
      preferred_deal_types: values.preferred_deal_types.split(',').map((row) => row.trim()).filter(Boolean),
      geographic_focus: values.geographic_focus.split(',').map((row) => row.trim()).filter(Boolean),
    };
    updateBroker.mutate(payload, {
      onSuccess: () => onOpenChange(false),
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
              <Dialog.Title className="font-display text-lg font-medium text-[var(--ink)]">Edit broker</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-[var(--slate)]">
                Maintain the broker relationship and default commercial terms.
              </Dialog.Description>
            </div>
            <Dialog.Close aria-label="Close broker dialog" className="rounded-sm p-1 text-[var(--slate)] hover:text-[var(--ink)]">
              <X className="h-4 w-4" strokeWidth={1.75} />
            </Dialog.Close>
          </div>
          <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={submit}>
            <FormField label="Company" required>
              <Input value={values.company_name} onChange={(event) => field('company_name', event.target.value)} />
            </FormField>
            <FormField label="Contact name" required>
              <Input value={values.contact_name} onChange={(event) => field('contact_name', event.target.value)} />
            </FormField>
            <FormField label="Email" required>
              <Input type="email" value={values.email} onChange={(event) => field('email', event.target.value)} />
            </FormField>
            <FormField label="Phone" hint="Optional">
              <Input value={values.phone} onChange={(event) => field('phone', event.target.value)} />
            </FormField>
            <FormField label="Status">
              <SelectNative options={STATUS_OPTIONS} value={values.status} onChange={(event) => field('status', event.target.value)} />
            </FormField>
            <FormField label="Default commission rate" hint="Optional">
              <Input inputMode="decimal" value={values.default_commission_rate} onChange={(event) => field('default_commission_rate', event.target.value)} />
            </FormField>
            <FormField label="Commission type" hint="Optional">
              <SelectNative placeholder="Unspecified" options={BROKER_COMMISSION_TYPE_OPTIONS} value={values.commission_type} onChange={(event) => field('commission_type', event.target.value)} />
            </FormField>
            <FormField label="Preferred deal types" hint="Comma-separated">
              <Input value={values.preferred_deal_types} onChange={(event) => field('preferred_deal_types', event.target.value)} />
            </FormField>
            <FormField label="Geographic focus" hint="Comma-separated" className="sm:col-span-2">
              <Input value={values.geographic_focus} onChange={(event) => field('geographic_focus', event.target.value)} />
            </FormField>
            {error ? <p role="alert" className="text-sm text-red-600 sm:col-span-2">{error}</p> : null}
            <div className="flex justify-end gap-2 pt-2 sm:col-span-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={updateBroker.isPending}>
                <Save className="h-4 w-4" strokeWidth={1.75} />
                {updateBroker.isPending ? 'Saving…' : 'Save broker'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
