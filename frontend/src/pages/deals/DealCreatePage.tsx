import { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { Panel, Field as PanelField } from '@/components/deals/Panel';
import { FormField } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNative } from '@/components/ui/select-native';
import { Button } from '@/components/ui/button';
import { ModeToggle } from '@/components/deals/form/ModeToggle';
import { PropertiesSection } from '@/components/deals/form/PropertiesSection';
import {
  INVESTMENT_TYPE_OPTIONS,
  RELATIONSHIP_RATING_OPTIONS,
  SOURCE_CHANNEL_OPTIONS,
  SPONSOR_ENTITY_TYPE_OPTIONS,
} from '@/components/deals/form/options';
import {
  createDealSchema,
  defaultCreateDealValues,
  type CreateDealForm,
} from '@/components/deals/form/schema';
import {
  useBrokers,
  useCreateDeal,
  useFunds,
  useSponsors,
  type BrokerInput,
  type CreateDealPayload,
  type SponsorInput,
} from '@/lib/api/deals';
import { apiErrorMessage, fieldErrors } from '@/lib/apiError';
import type { Sponsor, Property } from '@/types/deal';

const SERVER_FIELD_TO_FORM: Record<string, keyof CreateDealForm> = {
  name: 'name',
  investment_type: 'investment_type',
  requested_amount: 'requested_amount',
  source_channel: 'source_channel',
  source_date: 'source_date',
};

export default function DealCreatePage() {
  const navigate = useNavigate();
  const form = useForm<CreateDealForm>({
    resolver: zodResolver(createDealSchema),
    defaultValues: defaultCreateDealValues,
  });
  const { register, handleSubmit, watch, setValue, setError, formState } = form;
  const errors = formState.errors;

  const sponsorsQuery = useSponsors();
  const brokersQuery = useBrokers();
  const fundsQuery = useFunds();
  const createDeal = useCreateDeal();
  const [banner, setBanner] = useState<string | null>(null);

  const sponsorMode = watch('sponsor_mode');
  const brokerMode = watch('broker_mode');

  const sponsorOptions = (sponsorsQuery.data ?? []).map((s) => ({ value: s.id, label: s.entity_name }));
  const brokerOptions = (brokersQuery.data ?? []).map((b) => ({
    value: b.id,
    label: `${b.company_name} — ${b.contact_name}`,
  }));
  const fundOptions = (fundsQuery.data ?? []).map((f) => ({ value: f.id, label: f.name }));

  const onSubmit = (values: CreateDealForm) => {
    setBanner(null);
    const sponsor: string | SponsorInput =
      values.sponsor_mode === 'existing'
        ? values.sponsor_id ?? ''
        : {
            entity_name: values.sponsor_new.entity_name ?? '',
            entity_type: (values.sponsor_new.entity_type ?? 'llc') as Sponsor['entity_type'],
            primary_contact_name: values.sponsor_new.primary_contact_name ?? '',
            primary_contact_email: values.sponsor_new.primary_contact_email ?? '',
            primary_contact_phone: values.sponsor_new.primary_contact_phone ?? '',
            relationship_rating: (values.sponsor_new.relationship_rating ?? 'new') as Sponsor['relationship_rating'],
          };

    let broker: string | BrokerInput | null = null;
    if (values.broker_mode === 'existing') broker = values.broker_id ?? '';
    else if (values.broker_mode === 'new') {
      broker = {
        company_name: values.broker_new.company_name ?? '',
        contact_name: values.broker_new.contact_name ?? '',
        email: values.broker_new.email ?? '',
        phone: values.broker_new.phone ?? '',
      };
    }

    const properties = values.properties.map((row) =>
      row.mode === 'existing'
        ? (row.property_id ?? '')
        : {
            address: row.address ?? '',
            city: row.city ?? '',
            state: row.state ?? '',
            zip: row.zip ?? '',
            property_type: (row.property_type ?? 'other') as Property['property_type'],
            msa: row.msa ?? '',
          },
    );

    const payload: CreateDealPayload = {
      name: values.name,
      investment_type: values.investment_type as CreateDealPayload['investment_type'],
      requested_amount: values.requested_amount,
      source_channel: values.source_channel as CreateDealPayload['source_channel'],
      source_date: values.source_date,
      fund: values.fund_id || null,
      sponsor,
      broker,
      properties,
    };

    createDeal.mutate(payload, {
      onSuccess: (deal) => navigate(`/deals/${deal.id}`),
      onError: (error) => {
        const fields = fieldErrors(error);
        let mapped = false;
        for (const [serverField, message] of Object.entries(fields)) {
          const formField = SERVER_FIELD_TO_FORM[serverField];
          if (formField) {
            setError(formField, { message });
            mapped = true;
          }
        }
        setBanner(mapped ? 'Please fix the highlighted fields.' : apiErrorMessage(error));
      },
    });
  };

  return (
    <FormProvider {...form}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <header className="animate-fade-up space-y-3 border-b border-[var(--border)] pb-6">
          <Link
            to="/deals"
            className="inline-flex items-center gap-1.5 text-sm text-[var(--slate)] transition-colors hover:text-[var(--ink)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            All deals
          </Link>
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--slate)]">New deal</p>
            <h1 className="font-display mt-2 text-3xl font-medium tracking-tight text-[var(--ink)]">
              Originate a deal
            </h1>
            <p className="mt-2 max-w-xl text-[var(--slate)]">
              Capture the terms, sponsor, and collateral. New sponsors, brokers, and properties are
              created with the deal — no need to set them up first.
            </p>
          </div>
        </header>

        {banner ? (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
            <p>{banner}</p>
          </div>
        ) : null}

        <div className="animate-fade-up stagger-1 space-y-6">
          {/* Deal terms */}
          <Panel title="Deal terms">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Deal name" required error={errors.name?.message} className="sm:col-span-2">
                <Input
                  placeholder="e.g. Larkspur Apartments Bridge"
                  aria-invalid={Boolean(errors.name)}
                  {...register('name')}
                />
              </FormField>
              <FormField label="Investment type" required error={errors.investment_type?.message}>
                <SelectNative
                  placeholder="Select a structure"
                  options={INVESTMENT_TYPE_OPTIONS}
                  aria-invalid={Boolean(errors.investment_type)}
                  {...register('investment_type')}
                />
              </FormField>
              <FormField label="Requested amount" required error={errors.requested_amount?.message}>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--slate)]">
                    $
                  </span>
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    className="pl-6 tabular-nums"
                    aria-invalid={Boolean(errors.requested_amount)}
                    {...register('requested_amount')}
                  />
                </div>
              </FormField>
              <FormField label="Source channel" required error={errors.source_channel?.message}>
                <SelectNative
                  placeholder="How was it sourced?"
                  options={SOURCE_CHANNEL_OPTIONS}
                  aria-invalid={Boolean(errors.source_channel)}
                  {...register('source_channel')}
                />
              </FormField>
              <FormField label="Source date" required error={errors.source_date?.message}>
                <Input type="date" aria-invalid={Boolean(errors.source_date)} {...register('source_date')} />
              </FormField>
              <FormField label="Fund" hint="Optional — assign later if undecided" className="sm:col-span-2">
                <SelectNative placeholder="Unassigned" options={fundOptions} {...register('fund_id')} />
              </FormField>
            </div>
          </Panel>

          {/* Sponsor */}
          <Panel
            title="Sponsor"
            action={
              <ModeToggle
                aria-label="Existing or new sponsor"
                value={sponsorMode}
                onChange={(next) => setValue('sponsor_mode', next, { shouldValidate: false })}
                options={[
                  { value: 'existing', label: 'Existing' },
                  { value: 'new', label: 'New' },
                ]}
              />
            }
          >
            {sponsorMode === 'existing' ? (
              <FormField label="Select sponsor" required error={errors.sponsor_id?.message}>
                <SelectNative
                  placeholder={sponsorsQuery.isLoading ? 'Loading…' : 'Choose a sponsor'}
                  options={sponsorOptions}
                  aria-invalid={Boolean(errors.sponsor_id)}
                  {...register('sponsor_id')}
                />
              </FormField>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Entity name" required error={errors.sponsor_new?.entity_name?.message}>
                  <Input aria-invalid={Boolean(errors.sponsor_new?.entity_name)} {...register('sponsor_new.entity_name')} />
                </FormField>
                <FormField label="Entity type" required error={errors.sponsor_new?.entity_type?.message}>
                  <SelectNative options={SPONSOR_ENTITY_TYPE_OPTIONS} {...register('sponsor_new.entity_type')} />
                </FormField>
                <FormField label="Primary contact" required error={errors.sponsor_new?.primary_contact_name?.message}>
                  <Input
                    aria-invalid={Boolean(errors.sponsor_new?.primary_contact_name)}
                    {...register('sponsor_new.primary_contact_name')}
                  />
                </FormField>
                <FormField label="Contact email" required error={errors.sponsor_new?.primary_contact_email?.message}>
                  <Input
                    type="email"
                    aria-invalid={Boolean(errors.sponsor_new?.primary_contact_email)}
                    {...register('sponsor_new.primary_contact_email')}
                  />
                </FormField>
                <FormField label="Contact phone" hint="Optional">
                  <Input {...register('sponsor_new.primary_contact_phone')} />
                </FormField>
                <FormField label="Relationship" error={errors.sponsor_new?.relationship_rating?.message}>
                  <SelectNative options={RELATIONSHIP_RATING_OPTIONS} {...register('sponsor_new.relationship_rating')} />
                </FormField>
              </div>
            )}
          </Panel>

          {/* Broker */}
          <Panel
            title="Broker"
            action={
              <ModeToggle
                aria-label="Broker source"
                value={brokerMode}
                onChange={(next) => setValue('broker_mode', next, { shouldValidate: false })}
                options={[
                  { value: 'none', label: 'None' },
                  { value: 'existing', label: 'Existing' },
                  { value: 'new', label: 'New' },
                ]}
              />
            }
          >
            {brokerMode === 'none' ? (
              <PanelField label="Broker">Sourced directly — no broker on this deal.</PanelField>
            ) : brokerMode === 'existing' ? (
              <FormField label="Select broker" required error={errors.broker_id?.message}>
                <SelectNative
                  placeholder={brokersQuery.isLoading ? 'Loading…' : 'Choose a broker'}
                  options={brokerOptions}
                  aria-invalid={Boolean(errors.broker_id)}
                  {...register('broker_id')}
                />
              </FormField>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Company" required error={errors.broker_new?.company_name?.message}>
                  <Input aria-invalid={Boolean(errors.broker_new?.company_name)} {...register('broker_new.company_name')} />
                </FormField>
                <FormField label="Contact name" error={errors.broker_new?.contact_name?.message}>
                  <Input {...register('broker_new.contact_name')} />
                </FormField>
                <FormField label="Email" required error={errors.broker_new?.email?.message}>
                  <Input type="email" aria-invalid={Boolean(errors.broker_new?.email)} {...register('broker_new.email')} />
                </FormField>
                <FormField label="Phone" hint="Optional">
                  <Input {...register('broker_new.phone')} />
                </FormField>
              </div>
            )}
          </Panel>

          <PropertiesSection />
        </div>

        <div className="animate-fade-up sticky bottom-0 -mx-6 flex items-center justify-end gap-3 border-t border-[var(--border)] bg-[var(--paper)]/85 px-6 py-4 backdrop-blur lg:-mx-10 lg:px-10">
          <Button type="button" variant="ghost" asChild>
            <Link to="/deals">Cancel</Link>
          </Button>
          <Button type="submit" disabled={createDeal.isPending}>
            {createDeal.isPending ? 'Creating…' : 'Create deal'}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}
