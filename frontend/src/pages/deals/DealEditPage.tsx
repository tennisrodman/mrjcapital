import { useContext, useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, Pencil, Plus, Star, X } from 'lucide-react';
import { Panel, Field as PanelField } from '@/components/deals/Panel';
import { PropertyFactsDialog } from '@/components/deals/PropertyFactsDialog';
import { SponsorFactsDialog } from '@/components/deals/SponsorFactsDialog';
import { BrokerFactsDialog } from '@/components/deals/BrokerFactsDialog';
import { NewPropertyDialog } from '@/components/deals/NewPropertyDialog';
import { FormField } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNative } from '@/components/ui/select-native';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Spinner, ErrorState } from '@/components/deals/States';
import {
  buildDealUpdatePayload,
  type EditDealForm,
} from '@/components/deals/form/editPayload';
import { isOptionalCurrency } from '@/components/deals/form/schema';
import {
  DEAL_PROFILE_OPTIONS,
  DEAL_PURPOSE_OPTIONS,
  INVESTMENT_TYPE_OPTIONS,
  SOURCE_CHANNEL_OPTIONS,
} from '@/components/deals/form/options';
import {
  useBrokers,
  useDeal,
  useDealAssignees,
  useFunds,
  useProperties,
  useSponsors,
  useUpdateDeal,
} from '@/lib/api/deals';
import { apiErrorMessage, fieldErrors } from '@/lib/apiError';
import { PROPERTY_TYPE_LABELS } from '@/lib/dealChoices';
import type { Property } from '@/types/deal';
import { AuthContext } from '@/context/AuthContext';

const DEPOSIT_STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'received', label: 'Received' },
  { value: 'applied_to_closing', label: 'Applied to closing' },
  { value: 'refunded', label: 'Refunded' },
];

export default function DealEditPage() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const isStaff = Boolean(user?.is_staff);
  const dealQuery = useDeal(id);
  const sponsorsQuery = useSponsors();
  const brokersQuery = useBrokers();
  const fundsQuery = useFunds();
  const propertiesQuery = useProperties();
  const assigneesQuery = useDealAssignees(isStaff);
  const updateDeal = useUpdateDeal(id);

  const { register, handleSubmit, reset, formState } = useForm<EditDealForm>();
  const errors = formState.errors;
  const [propertyIds, setPropertyIds] = useState<string[]>([]);
  const [initialPropertyIds, setInitialPropertyIds] = useState<string[]>([]);
  const [propertyError, setPropertyError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [sponsorFactsOpen, setSponsorFactsOpen] = useState(false);
  const [brokerFactsOpen, setBrokerFactsOpen] = useState(false);
  const [newPropertyOpen, setNewPropertyOpen] = useState(false);
  const [editingProperty, setEditingProperty] = useState<Property | null>(null);
  const initializedDealId = useRef<string | null>(null);

  const deal = dealQuery.data;
  const referenceDataLoading =
    sponsorsQuery.isLoading ||
    brokersQuery.isLoading ||
    fundsQuery.isLoading ||
    propertiesQuery.isLoading ||
    (isStaff && assigneesQuery.isLoading);
  const referenceDataError =
    sponsorsQuery.isError ||
    brokersQuery.isError ||
    fundsQuery.isError ||
    propertiesQuery.isError ||
    (isStaff && assigneesQuery.isError);

  const retryReferenceData = () => {
    const retries: Promise<unknown>[] = [
      sponsorsQuery.refetch(),
      brokersQuery.refetch(),
      fundsQuery.refetch(),
      propertiesQuery.refetch(),
    ];
    if (isStaff) retries.push(assigneesQuery.refetch());
    void Promise.all(retries);
  };

  useEffect(() => {
    if (!deal || initializedDealId.current === deal.id) return;
    initializedDealId.current = deal.id;
    reset({
      name: deal.name,
      investment_type: deal.investment_type,
      requested_amount: deal.requested_amount,
      purpose: deal.purpose,
      profile: deal.profile,
      estimated_value: deal.estimated_value ?? '',
      renovation_budget: deal.renovation_budget ?? '',
      description: deal.description,
      source_channel: deal.source_channel,
      source_date: deal.source_date,
      sponsor_id: deal.sponsor ?? '',
      broker_id: deal.broker ?? '',
      fund_id: deal.fund ?? '',
      assigned_analyst_id: deal.assigned_analyst != null ? String(deal.assigned_analyst) : '',
      deposit_status: deal.deposit_status ?? '',
      deposit_received_date: deal.deposit_received_date ?? '',
      deposit_account_label: deal.deposit_account_label ?? '',
      deposit_refund_conditions: deal.deposit_refund_conditions ?? '',
      exclusivity_granted: deal.exclusivity_granted == null ? '' : deal.exclusivity_granted ? 'yes' : 'no',
      exclusivity_expiry_date: deal.exclusivity_expiry_date ?? '',
      key_negotiation_changes: deal.key_negotiation_changes ?? '',
    });
    const nextPropertyIds = deal.properties.map((entry) => entry.property.id);
    setPropertyIds(nextPropertyIds);
    setInitialPropertyIds(nextPropertyIds);
    setPropertyError(null);
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
  if (referenceDataLoading) return <Spinner label="Loading deal relationships…" />;
  if (referenceDataError) {
    return (
      <div className="space-y-6">
        <BackLink id={id} />
        <ErrorState
          title="Deal relationships unavailable"
          message="Sponsors, brokers, funds, properties, or assignees could not be loaded. The edit form is paused so existing relationships are not mistaken for empty data."
          onRetry={retryReferenceData}
        />
      </div>
    );
  }

  const allProperties = propertiesQuery.data ?? [];
  const propertyById = new Map(allProperties.map((p) => [p.id, p]));
  const selected = propertyIds.map((pid) => propertyById.get(pid)).filter(Boolean) as Property[];
  const available = allProperties.filter((p) => !propertyIds.includes(p.id));
  const fundOptions = (fundsQuery.data ?? []).map((f) => ({ value: f.id, label: f.name }));
  const sponsorOptions = (sponsorsQuery.data ?? []).map((sponsor) => ({ value: sponsor.id, label: sponsor.entity_name }));
  const brokerOptions = (brokersQuery.data ?? []).map((broker) => ({ value: broker.id, label: `${broker.company_name} — ${broker.contact_name}` }));
  const assigneeOptions = (assigneesQuery.data ?? []).map((assignee) => ({ value: String(assignee.id), label: assignee.username }));
  const sponsorEditable = isStaff || !deal.sponsor;
  const brokerEditable = isStaff || !deal.broker;
  const fundEditable = isStaff || !deal.fund;

  const addProperty = (pid: string) => {
    if (pid) {
      setPropertyIds((prev) => [...prev, pid]);
      setPropertyError(null);
    }
  };
  const removeProperty = (pid: string) => {
    setPropertyIds((prev) => prev.filter((x) => x !== pid));
    setPropertyError(null);
  };
  const makePrimary = (pid: string) =>
    setPropertyIds((prev) => [pid, ...prev.filter((x) => x !== pid)]);

  const onSubmit = (values: EditDealForm) => {
    setBanner(null);
    const propertiesChanged = !sameOrderedIds(propertyIds, initialPropertyIds);
    if (propertiesChanged && initialPropertyIds.length > 0 && propertyIds.length === 0) {
      setPropertyError('Keep at least one property on the deal.');
      return;
    }
    const payload = buildDealUpdatePayload(values, formState.dirtyFields, {
      sponsorEditable,
      brokerEditable,
      fundEditable,
      analystEditable: isStaff,
      propertiesChanged,
      propertyIds,
    });
    updateDeal.mutate(payload, {
      onSuccess: () => navigate(`/deals/${id}`),
      onError: (error) => {
        const fields = fieldErrors(error);
        setBanner(Object.keys(fields).length ? Object.values(fields)[0] : apiErrorMessage(error));
      },
    });
  };

  return (
    <>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <header className="animate-fade-up space-y-3 border-b border-[var(--border)] pb-6">
        <BackLink id={id} />
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--slate)]">Edit deal</p>
          <h1 className="font-display mt-2 break-words text-3xl font-medium text-[var(--ink)]">
            {deal.name}
          </h1>
          <p className="mt-2 max-w-xl text-[var(--slate)]">
            Update terms, collateral, relationships, assignment, and negotiation details. Staff
            corrections are audited; pipeline stage moves through the controls on the deal page.
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
                    validate: (value) =>
                      (isOptionalCurrency(value) && Number(value) > 0)
                      || 'Enter a positive amount with no more than 2 decimal places',
                  })}
                />
              </div>
            </FormField>
            <FormField label="Estimated property value" hint="Optional" error={errors.estimated_value?.message}>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--slate)]">
                  $
                </span>
                <Input
                  inputMode="decimal"
                  className="pl-6 tabular-nums"
                  aria-invalid={Boolean(errors.estimated_value)}
                  {...register('estimated_value', {
                    validate: (value) =>
                      isOptionalCurrency(value)
                      || 'Enter zero or a positive amount with no more than 2 decimal places',
                  })}
                />
              </div>
            </FormField>
            <FormField label="Renovation budget" hint="Optional" error={errors.renovation_budget?.message}>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--slate)]">
                  $
                </span>
                <Input
                  inputMode="decimal"
                  className="pl-6 tabular-nums"
                  aria-invalid={Boolean(errors.renovation_budget)}
                  {...register('renovation_budget', {
                    validate: (value) =>
                      isOptionalCurrency(value)
                      || 'Enter zero or a positive amount with no more than 2 decimal places',
                  })}
                />
              </div>
            </FormField>
            <FormField label="Purpose" hint="Optional">
              <SelectNative placeholder="Select purpose" options={DEAL_PURPOSE_OPTIONS} {...register('purpose')} />
            </FormField>
            <FormField label="Profile" hint="Optional">
              <SelectNative placeholder="Select profile" options={DEAL_PROFILE_OPTIONS} {...register('profile')} />
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
            <FormField label="Fund" hint={fundEditable ? 'Optional' : 'Staff can correct an existing assignment'} className="sm:col-span-2">
              <SelectNative
                placeholder="Unassigned"
                options={fundOptions}
                {...register('fund_id')}
                disabled={!fundEditable}
                className={!fundEditable ? 'opacity-70' : undefined}
              />
            </FormField>
            <FormField label="Description" hint="Optional" className="sm:col-span-2">
              <Textarea rows={4} {...register('description')} />
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
                  <button
                    type="button"
                    onClick={() => setEditingProperty(property)}
                    aria-label={`Edit underwriting facts for ${property.address}`}
                    title="Edit property facts"
                    className="rounded-sm p-1 text-[var(--slate)] transition-colors hover:bg-[var(--ink)]/5 hover:text-[var(--ink)]"
                  >
                    <Pencil className="h-4 w-4" strokeWidth={1.75} />
                  </button>
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
          {selected.length === 0 ? (
            <div className="mb-4 rounded-md border border-dashed border-[var(--border)] bg-[var(--paper)] px-4 py-5 text-sm text-[var(--slate)]">
              No property attached yet.
            </div>
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
            <Button type="button" variant="outline" onClick={() => setNewPropertyOpen(true)}>
              Register new
            </Button>
          </div>
          {propertyError ? <p className="mt-2 text-xs text-red-600">{propertyError}</p> : null}
        </Panel>

        <Panel
          title="Relationships"
          action={deal.sponsor_detail || deal.broker_detail ? (
            <div className="flex flex-wrap gap-2">
              {deal.sponsor_detail ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setSponsorFactsOpen(true)}>
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Edit sponsor
                </Button>
              ) : null}
              {deal.broker_detail ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setBrokerFactsOpen(true)}>
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Edit broker
                </Button>
              ) : null}
            </div>
          ) : undefined}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Sponsor" hint={sponsorEditable ? 'Select or correct' : 'Staff can change this'}>
              <SelectNative placeholder="Unassigned" options={sponsorOptions} disabled={!sponsorEditable} {...register('sponsor_id')} />
            </FormField>
            <FormField label="Broker" hint={brokerEditable ? 'Select or correct' : 'Staff can change this'}>
              <SelectNative placeholder="None" options={brokerOptions} disabled={!brokerEditable} {...register('broker_id')} />
            </FormField>
            {isStaff ? (
              <FormField label="Assigned analyst">
                <SelectNative placeholder="Unassigned" options={assigneeOptions} {...register('assigned_analyst_id')} />
              </FormField>
            ) : (
              <PanelField label="Analyst">{deal.assigned_analyst_detail?.username ?? 'Unassigned'}</PanelField>
            )}
          </div>
        </Panel>

        <Panel title="Negotiation details">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Deposit status" hint="Optional">
              <SelectNative placeholder="Not tracked" options={DEPOSIT_STATUS_OPTIONS} {...register('deposit_status')} />
            </FormField>
            <FormField label="Deposit received date" hint="Optional">
              <Input type="date" {...register('deposit_received_date')} />
            </FormField>
            <FormField label="Deposit account" hint="Account label only · optional">
              <Input placeholder="e.g. Operating escrow" {...register('deposit_account_label')} />
            </FormField>
            <FormField label="Exclusivity" hint="Optional">
              <SelectNative
                placeholder="Not specified"
                options={[{ value: 'yes', label: 'Granted' }, { value: 'no', label: 'Not granted' }]}
                {...register('exclusivity_granted')}
              />
            </FormField>
            <FormField label="Exclusivity expiry" hint="Optional">
              <Input type="date" {...register('exclusivity_expiry_date')} />
            </FormField>
            <FormField label="Deposit refund conditions" hint="Optional" className="sm:col-span-2">
              <Textarea rows={2} {...register('deposit_refund_conditions')} />
            </FormField>
            <FormField label="Material negotiation changes" hint="Optional" className="sm:col-span-2">
              <Textarea rows={3} {...register('key_negotiation_changes')} />
            </FormField>
          </div>
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

      {deal.sponsor_detail ? (
        <SponsorFactsDialog
          sponsor={deal.sponsor_detail}
          canEditIdentity={isStaff}
          open={sponsorFactsOpen}
          onOpenChange={setSponsorFactsOpen}
        />
      ) : null}
      {deal.broker_detail ? (
        <BrokerFactsDialog
          broker={deal.broker_detail}
          open={brokerFactsOpen}
          onOpenChange={setBrokerFactsOpen}
        />
      ) : null}
      <NewPropertyDialog
        open={newPropertyOpen}
        onOpenChange={setNewPropertyOpen}
        onCreated={(property) => {
          setPropertyIds((current) => [...current, property.id]);
          setPropertyError(null);
        }}
      />
      {editingProperty ? (
        <PropertyFactsDialog
          property={editingProperty}
          canEditIdentity={isStaff}
          open
          onOpenChange={(open) => {
            if (!open) setEditingProperty(null);
          }}
        />
      ) : null}
    </>
  );
}

function sameOrderedIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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
