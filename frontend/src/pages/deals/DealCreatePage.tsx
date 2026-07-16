import { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { Panel, Field as PanelField } from '@/components/deals/Panel';
import { FormField } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNative } from '@/components/ui/select-native';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ModeToggle } from '@/components/deals/form/ModeToggle';
import { PropertiesSection } from '@/components/deals/form/PropertiesSection';
import {
  INVESTMENT_TYPE_OPTIONS,
  DEAL_PROFILE_OPTIONS,
  DEAL_PURPOSE_OPTIONS,
  BROKER_COMMISSION_TYPE_OPTIONS,
  RELATIONSHIP_RATING_OPTIONS,
  SOURCE_CHANNEL_OPTIONS,
  SPONSOR_ENTITY_TYPE_OPTIONS,
  SPONSOR_CONNECTION_OPTIONS,
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
import type { Broker, Sponsor, Property } from '@/types/deal';

const SERVER_FIELD_TO_FORM: Record<string, keyof CreateDealForm> = {
  name: 'name',
  investment_type: 'investment_type',
  requested_amount: 'requested_amount',
  purpose: 'purpose',
  profile: 'profile',
  estimated_value: 'estimated_value',
  renovation_budget: 'renovation_budget',
  description: 'description',
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
  const dealProfile = watch('profile');

  const sponsorOptions = (sponsorsQuery.data ?? []).map((s) => ({ value: s.id, label: s.entity_name }));
  const brokerOptions = (brokersQuery.data ?? []).map((b) => ({
    value: b.id,
    label: `${b.company_name} — ${b.contact_name}`,
  }));
  const fundOptions = (fundsQuery.data ?? []).map((f) => ({ value: f.id, label: f.name }));

  const onSubmit = (values: CreateDealForm) => {
    setBanner(null);
    let sponsor: string | SponsorInput | null = null;
    if (values.sponsor_mode === 'existing') sponsor = values.sponsor_id ?? '';
    else if (values.sponsor_mode === 'new') {
      sponsor = {
        entity_name: values.sponsor_new.entity_name ?? '',
        entity_type: (values.sponsor_new.entity_type ?? 'llc') as Sponsor['entity_type'],
        primary_contact_name: values.sponsor_new.primary_contact_name ?? '',
        primary_contact_email: values.sponsor_new.primary_contact_email ?? '',
        relationship_rating: (values.sponsor_new.relationship_rating ?? 'new') as Sponsor['relationship_rating'],
        ...(values.sponsor_new.primary_contact_phone?.trim()
          ? { primary_contact_phone: values.sponsor_new.primary_contact_phone.trim() }
          : {}),
        ...(values.sponsor_new.website?.trim()
          ? { website: values.sponsor_new.website.trim() }
          : {}),
        ...(values.sponsor_new.years_experience
          ? { years_experience: Number(values.sponsor_new.years_experience) }
          : {}),
        ...(values.sponsor_new.completed_projects
          ? { completed_projects: Number(values.sponsor_new.completed_projects) }
          : {}),
        ...(values.sponsor_new.bankruptcy_history
          ? { bankruptcy_history: values.sponsor_new.bankruptcy_history === 'yes' }
          : {}),
        ...(values.sponsor_new.business_address?.trim()
          ? { business_address: values.sponsor_new.business_address.trim() }
          : {}),
        ...(values.sponsor_new.total_units_owned
          ? { total_units_owned: Number(values.sponsor_new.total_units_owned) }
          : {}),
        ...(values.sponsor_new.total_sf_managed
          ? { total_sf_managed: Number(values.sponsor_new.total_sf_managed) }
          : {}),
        ...(values.sponsor_new.assets_under_management?.trim()
          ? { assets_under_management: values.sponsor_new.assets_under_management.trim() }
          : {}),
        ...(values.sponsor_new.connection_source
          ? { connection_source: values.sponsor_new.connection_source as Sponsor['connection_source'] }
          : {}),
      };
    }

    let broker: string | BrokerInput | null = null;
    if (values.broker_mode === 'existing') broker = values.broker_id ?? '';
    else if (values.broker_mode === 'new') {
      broker = {
        company_name: values.broker_new.company_name ?? '',
        contact_name: values.broker_new.contact_name ?? '',
        email: values.broker_new.email ?? '',
        ...(values.broker_new.phone?.trim() ? { phone: values.broker_new.phone.trim() } : {}),
        ...(values.broker_new.default_commission_rate?.trim()
          ? { default_commission_rate: values.broker_new.default_commission_rate.trim() }
          : {}),
        ...(values.broker_new.commission_type
          ? { commission_type: values.broker_new.commission_type as Broker['commission_type'] }
          : {}),
        preferred_deal_types: (values.broker_new.preferred_deal_types ?? '')
          .split(',').map((value) => value.trim()).filter(Boolean),
        geographic_focus: (values.broker_new.geographic_focus ?? '')
          .split(',').map((value) => value.trim()).filter(Boolean),
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
            ...(row.subtype?.trim() ? { subtype: row.subtype.trim() } : {}),
            ...(row.units ? { units: Number(row.units) } : {}),
            ...(row.rentable_square_feet
              ? { rentable_square_feet: Number(row.rentable_square_feet) }
              : {}),
            ...(row.year_built ? { year_built: Number(row.year_built) } : {}),
            ...(row.year_renovated ? { year_renovated: Number(row.year_renovated) } : {}),
            ...(row.county?.trim() ? { county: row.county.trim() } : {}),
            ...(row.msa?.trim() ? { msa: row.msa.trim() } : {}),
            ...(row.number_of_buildings ? { number_of_buildings: Number(row.number_of_buildings) } : {}),
            ...(row.number_of_stories ? { number_of_stories: Number(row.number_of_stories) } : {}),
            ...(row.parking_spaces ? { parking_spaces: Number(row.parking_spaces) } : {}),
            ...(row.lot_size_acres?.trim() ? { lot_size_acres: row.lot_size_acres.trim() } : {}),
            ...(row.flood_zone?.trim() ? { flood_zone: row.flood_zone.trim() } : {}),
            ...(row.zoning_designation?.trim()
              ? { zoning_designation: row.zoning_designation.trim() }
              : {}),
            ...(row.environmental_status
              ? { environmental_status: row.environmental_status as Property['environmental_status'] }
              : {}),
          },
    );

    const payload: CreateDealPayload = {
      name: values.name,
      investment_type: values.investment_type as CreateDealPayload['investment_type'],
      requested_amount: values.requested_amount,
      ...(values.purpose?.trim()
        ? { purpose: values.purpose.trim() as CreateDealPayload['purpose'] }
        : {}),
      ...(values.profile?.trim()
        ? { profile: values.profile.trim() as CreateDealPayload['profile'] }
        : {}),
      ...(values.estimated_value?.trim() ? { estimated_value: values.estimated_value.trim() } : {}),
      ...(values.renovation_budget?.trim()
        ? { renovation_budget: values.renovation_budget.trim() }
        : {}),
      ...(values.description?.trim() ? { description: values.description.trim() } : {}),
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

  const onInvalid = () => {
    setBanner('Please fix the highlighted fields before creating the deal.');
  };

  return (
    <FormProvider {...form}>
      <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-6">
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
          <div role="alert" className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
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
                <p className="mt-1 text-xs text-[var(--slate)]">
                  Debt products are active. Other structures remain visible as planned scope.
                </p>
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
              <FormField label="Estimated property value" hint="Optional" error={errors.estimated_value?.message}>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--slate)]">
                    $
                  </span>
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    className="pl-6 tabular-nums"
                    aria-invalid={Boolean(errors.estimated_value)}
                    {...register('estimated_value')}
                  />
                </div>
              </FormField>
              {dealProfile === 'value_add' || dealProfile === 'construction' ? (
              <FormField label="Renovation budget" hint="Optional" error={errors.renovation_budget?.message}>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--slate)]">
                    $
                  </span>
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    className="pl-6 tabular-nums"
                    aria-invalid={Boolean(errors.renovation_budget)}
                    {...register('renovation_budget')}
                  />
                </div>
              </FormField>
              ) : null}
              <FormField label="Purpose" hint="Optional">
                <SelectNative placeholder="Select purpose" options={DEAL_PURPOSE_OPTIONS} {...register('purpose')} />
              </FormField>
              <FormField label="Profile" hint="Optional">
                <SelectNative placeholder="Select profile" options={DEAL_PROFILE_OPTIONS} {...register('profile')} />
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
              <FormField label="Description" hint="Optional" className="sm:col-span-2">
                <Textarea rows={4} {...register('description')} />
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
                  { value: 'none', label: 'None yet' },
                  { value: 'existing', label: 'Existing' },
                  { value: 'new', label: 'New' },
                ]}
              />
            }
          >
            {sponsorMode === 'none' ? (
              <PanelField label="Sponsor">Add sponsor or borrower details later.</PanelField>
            ) : sponsorMode === 'existing' ? (
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
                <FormField label="Website" hint="Optional" error={errors.sponsor_new?.website?.message}>
                  <Input
                    type="url"
                    placeholder="https://"
                    aria-invalid={Boolean(errors.sponsor_new?.website)}
                    {...register('sponsor_new.website')}
                  />
                </FormField>
                <FormField label="Years of experience" hint="Optional" error={errors.sponsor_new?.years_experience?.message}>
                  <Input
                    type="number"
                    min="0"
                    max="200"
                    step="1"
                    inputMode="numeric"
                    aria-invalid={Boolean(errors.sponsor_new?.years_experience)}
                    {...register('sponsor_new.years_experience')}
                  />
                </FormField>
                <FormField label="Completed projects" hint="Optional" error={errors.sponsor_new?.completed_projects?.message}>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    inputMode="numeric"
                    aria-invalid={Boolean(errors.sponsor_new?.completed_projects)}
                    {...register('sponsor_new.completed_projects')}
                  />
                </FormField>
                <FormField label="Bankruptcy history" hint="Optional">
                  <SelectNative
                    placeholder="Unknown"
                    options={[
                      { value: 'no', label: 'No' },
                      { value: 'yes', label: 'Yes' },
                    ]}
                    {...register('sponsor_new.bankruptcy_history')}
                  />
                </FormField>
                <FormField label="Business address" hint="Optional" className="sm:col-span-2">
                  <Textarea rows={2} {...register('sponsor_new.business_address')} />
                </FormField>
                <FormField label="Units currently owned" hint="Optional" error={errors.sponsor_new?.total_units_owned?.message}>
                  <Input type="number" min="0" step="1" {...register('sponsor_new.total_units_owned')} />
                </FormField>
                <FormField label="Square feet managed" hint="Optional" error={errors.sponsor_new?.total_sf_managed?.message}>
                  <Input type="number" min="0" step="1" {...register('sponsor_new.total_sf_managed')} />
                </FormField>
                <FormField label="Assets under management" hint="Optional" error={errors.sponsor_new?.assets_under_management?.message}>
                  <Input inputMode="decimal" {...register('sponsor_new.assets_under_management')} />
                </FormField>
                <FormField label="How we connected" hint="Optional">
                  <SelectNative
                    placeholder="Unknown"
                    options={SPONSOR_CONNECTION_OPTIONS}
                    {...register('sponsor_new.connection_source')}
                  />
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
                <FormField label="Contact name" required error={errors.broker_new?.contact_name?.message}>
                  <Input
                    aria-invalid={Boolean(errors.broker_new?.contact_name)}
                    {...register('broker_new.contact_name')}
                  />
                </FormField>
                <FormField label="Email" required error={errors.broker_new?.email?.message}>
                  <Input type="email" aria-invalid={Boolean(errors.broker_new?.email)} {...register('broker_new.email')} />
                </FormField>
                <FormField label="Phone" hint="Optional">
                  <Input {...register('broker_new.phone')} />
                </FormField>
                <FormField label="Default commission rate" hint="Optional" error={errors.broker_new?.default_commission_rate?.message}>
                  <Input inputMode="decimal" {...register('broker_new.default_commission_rate')} />
                </FormField>
                <FormField label="Commission type" hint="Optional">
                  <SelectNative
                    placeholder="Unspecified"
                    options={BROKER_COMMISSION_TYPE_OPTIONS}
                    {...register('broker_new.commission_type')}
                  />
                </FormField>
                <FormField label="Preferred deal types" hint="Comma-separated · optional">
                  <Input {...register('broker_new.preferred_deal_types')} />
                </FormField>
                <FormField label="Geographic focus" hint="Comma-separated · optional">
                  <Input {...register('broker_new.geographic_focus')} />
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
