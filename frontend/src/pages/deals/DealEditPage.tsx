import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Plus, Star, X } from 'lucide-react';
import { Panel, Field as PanelField } from '@/components/deals/Panel';
import { FormField } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNative } from '@/components/ui/select-native';
import { Button } from '@/components/ui/button';
import { Spinner, ErrorState } from '@/components/deals/States';
import { INVESTMENT_TYPE_OPTIONS, SOURCE_CHANNEL_OPTIONS } from '@/components/deals/form/options';
import { useDeal, useFunds, useProperties, useUpdateDeal, type UpdateDealPayload } from '@/lib/api/deals';
import { apiErrorMessage, fieldErrors } from '@/lib/apiError';
import { PROPERTY_TYPE_LABELS } from '@/lib/dealChoices';
import type { Property } from '@/types/deal';

interface EditForm {
  name: string;
  investment_type: string;
  requested_amount: string;
  source_channel: string;
  source_date: string;
  fund_id: string;
}

export default function DealEditPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dealQuery = useDeal(id);
  const fundsQuery = useFunds();
  const propertiesQuery = useProperties();
  const updateDeal = useUpdateDeal(id);

  const { register, handleSubmit, reset, formState } = useForm<EditForm>();
  const errors = formState.errors;
  const [propertyIds, setPropertyIds] = useState<string[]>([]);
  const [propertyError, setPropertyError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const deal = dealQuery.data;

  useEffect(() => {
    if (!deal) return;
    reset({
      name: deal.name,
      investment_type: deal.investment_type,
      requested_amount: deal.requested_amount,
      source_channel: deal.source_channel,
      source_date: deal.source_date,
      fund_id: deal.fund ?? '',
    });
    setPropertyIds(deal.properties.map((entry) => entry.property.id));
  }, [deal, reset]);

  if (dealQuery.isLoading) return <Spinner label="Loading deal…" />;
  if (dealQuery.isError || !deal) {
    return (
      <div className="space-y-6">
        <BackLink id={id} />
        <ErrorState title="Deal unavailable" onRetry={() => void dealQuery.refetch()} />
      </div>
    );
  }

  const allProperties = propertiesQuery.data ?? [];
  const propertyById = new Map(allProperties.map((p) => [p.id, p]));
  const selected = propertyIds.map((pid) => propertyById.get(pid)).filter(Boolean) as Property[];
  const available = allProperties.filter((p) => !propertyIds.includes(p.id));
  const fundOptions = (fundsQuery.data ?? []).map((f) => ({ value: f.id, label: f.name }));

  const addProperty = (pid: string) => {
    if (pid) {
      setPropertyIds((prev) => [...prev, pid]);
      setPropertyError(null);
    }
  };
  const removeProperty = (pid: string) => setPropertyIds((prev) => prev.filter((x) => x !== pid));
  const makePrimary = (pid: string) =>
    setPropertyIds((prev) => [pid, ...prev.filter((x) => x !== pid)]);

  const onSubmit = (values: EditForm) => {
    setBanner(null);
    if (propertyIds.length === 0) {
      setPropertyError('Keep at least one property on the deal.');
      return;
    }
    const payload: UpdateDealPayload = {
      name: values.name,
      investment_type: values.investment_type as UpdateDealPayload['investment_type'],
      requested_amount: values.requested_amount,
      source_channel: values.source_channel as UpdateDealPayload['source_channel'],
      source_date: values.source_date,
      fund: values.fund_id || null,
      property_ids: propertyIds,
    };
    updateDeal.mutate(payload, {
      onSuccess: () => navigate(`/deals/${id}`),
      onError: (error) => {
        const fields = fieldErrors(error);
        setBanner(Object.keys(fields).length ? Object.values(fields)[0] : apiErrorMessage(error));
      },
    });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <header className="animate-fade-up space-y-3 border-b border-[var(--border)] pb-6">
        <BackLink id={id} />
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--slate)]">Edit deal</p>
          <h1 className="font-display mt-2 text-3xl font-medium tracking-tight text-[var(--ink)]">
            {deal.name}
          </h1>
          <p className="mt-2 max-w-xl text-[var(--slate)]">
            Update terms and collateral. Sponsor and broker are fixed once a deal exists; pipeline
            stage moves through the transition controls on the deal page.
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
        <Panel title="Deal terms">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Deal name" required error={errors.name?.message} className="sm:col-span-2">
              <Input aria-invalid={Boolean(errors.name)} {...register('name', { required: 'Deal name is required' })} />
            </FormField>
            <FormField label="Investment type" required error={errors.investment_type?.message}>
              <SelectNative
                options={INVESTMENT_TYPE_OPTIONS}
                aria-invalid={Boolean(errors.investment_type)}
                {...register('investment_type', { required: 'Select an investment type' })}
              />
            </FormField>
            <FormField label="Requested amount" required error={errors.requested_amount?.message}>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--slate)]">
                  $
                </span>
                <Input
                  inputMode="decimal"
                  className="pl-6 tabular-nums"
                  aria-invalid={Boolean(errors.requested_amount)}
                  {...register('requested_amount', {
                    required: 'Enter the requested amount',
                    validate: (value) => Number(value) > 0 || 'Enter an amount greater than zero',
                  })}
                />
              </div>
            </FormField>
            <FormField label="Source channel" required error={errors.source_channel?.message}>
              <SelectNative
                options={SOURCE_CHANNEL_OPTIONS}
                aria-invalid={Boolean(errors.source_channel)}
                {...register('source_channel', { required: 'Select a source channel' })}
              />
            </FormField>
            <FormField label="Source date" required error={errors.source_date?.message}>
              <Input type="date" {...register('source_date', { required: 'Select a source date' })} />
            </FormField>
            <FormField label="Fund" hint="Optional" className="sm:col-span-2">
              <SelectNative placeholder="Unassigned" options={fundOptions} {...register('fund_id')} />
            </FormField>
          </div>
        </Panel>

        <Panel title="Properties" count={selected.length}>
          <p className="mb-4 text-xs text-[var(--slate)]">
            The first property is the deal’s primary location. Add or remove existing properties; to
            register a brand-new address, create it on a new deal or via the property tools.
          </p>
          {selected.length > 0 ? (
            <ul className="mb-4 divide-y divide-[var(--border)]">
              {selected.map((property, index) => (
                <li key={property.id} className="flex items-center gap-3 py-2.5 first:pt-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-[var(--ink)]">{property.address}</p>
                      {index === 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--brass)]">
                          <Star className="h-3 w-3 fill-current" strokeWidth={0} />
                          Primary
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs text-[var(--slate)]">
                      {property.city}, {property.state} · {PROPERTY_TYPE_LABELS[property.property_type]}
                    </p>
                  </div>
                  {index !== 0 ? (
                    <button
                      type="button"
                      onClick={() => makePrimary(property.id)}
                      className="rounded-sm px-2 py-1 text-xs text-[var(--slate)] transition-colors hover:text-[var(--brass)]"
                    >
                      Make primary
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => removeProperty(property.id)}
                    aria-label={`Remove ${property.address}`}
                    className="rounded-sm p-1 text-[var(--slate)] transition-colors hover:bg-[var(--ink)]/5 hover:text-[var(--ink)]"
                  >
                    <X className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex items-end gap-2">
            <FormField label="Add a property" className="flex-1">
              <SelectNative
                placeholder={available.length ? 'Select a property to attach' : 'No more properties available'}
                options={available.map((p) => ({
                  value: p.id,
                  label: `${p.address} — ${p.city}, ${p.state}`,
                }))}
                value=""
                onChange={(event) => addProperty(event.target.value)}
              />
            </FormField>
            <span className="hidden h-9 items-center text-[var(--slate)] sm:inline-flex">
              <Plus className="h-4 w-4" strokeWidth={1.75} />
            </span>
          </div>
          {propertyError ? <p className="mt-2 text-xs text-red-600">{propertyError}</p> : null}
        </Panel>

        <Panel title="Relationships">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
            <PanelField label="Sponsor">{deal.sponsor_detail?.entity_name ?? '—'}</PanelField>
            <PanelField label="Broker">{deal.broker_detail?.company_name ?? 'None'}</PanelField>
            <PanelField label="Analyst">{deal.assigned_analyst_detail?.username ?? 'Unassigned'}</PanelField>
          </dl>
          <p className="mt-3 text-xs text-[var(--slate)]">
            Sponsor and broker can’t be reassigned after origination.
          </p>
        </Panel>
      </div>

      <div className="animate-fade-up sticky bottom-0 -mx-6 flex items-center justify-end gap-3 border-t border-[var(--border)] bg-[var(--paper)]/85 px-6 py-4 backdrop-blur lg:-mx-10 lg:px-10">
        <Button type="button" variant="ghost" asChild>
          <Link to={`/deals/${id}`}>Cancel</Link>
        </Button>
        <Button type="submit" disabled={updateDeal.isPending}>
          {updateDeal.isPending ? 'Saving…' : 'Save changes'}
        </Button>
      </div>
    </form>
  );
}

function BackLink({ id }: { id: string }) {
  return (
    <Link
      to={`/deals/${id}`}
      className="inline-flex items-center gap-1.5 text-sm text-[var(--slate)] transition-colors hover:text-[var(--ink)]"
    >
      <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
      Back to deal
    </Link>
  );
}
