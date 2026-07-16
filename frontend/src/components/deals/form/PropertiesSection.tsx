import { useFieldArray, useFormContext } from 'react-hook-form';
import { Plus, Star, Trash2 } from 'lucide-react';
import { Panel } from '@/components/deals/Panel';
import { FormField } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNative } from '@/components/ui/select-native';
import { ModeToggle } from '@/components/deals/form/ModeToggle';
import {
  PROPERTY_ENVIRONMENTAL_STATUS_OPTIONS,
  PROPERTY_TYPE_OPTIONS,
  STATE_OPTIONS,
} from '@/components/deals/form/options';
import { useProperties } from '@/lib/api/deals';
import { PROPERTY_TYPE_LABELS } from '@/lib/dealChoices';
import type { CreateDealForm } from '@/components/deals/form/schema';

const emptyRow = {
  mode: 'existing' as const,
  property_id: '',
  address: '',
  city: '',
  state: '',
  zip: '',
  property_type: '',
  subtype: '',
  units: '',
  rentable_square_feet: '',
  year_built: '',
  year_renovated: '',
  county: '',
  msa: '',
  number_of_buildings: '',
  number_of_stories: '',
  parking_spaces: '',
  lot_size_acres: '',
  flood_zone: '',
  zoning_designation: '',
  environmental_status: '',
};

export function PropertiesSection() {
  const { control, register, watch, setValue, formState } = useFormContext<CreateDealForm>();
  const { fields, append, remove } = useFieldArray({ control, name: 'properties' });
  const propertiesQuery = useProperties();
  const errors = formState.errors;

  const propertyOptions = (propertiesQuery.data ?? []).map((property) => ({
    value: property.id,
    label: `${property.address} — ${property.city}, ${property.state} · ${PROPERTY_TYPE_LABELS[property.property_type]}`,
  }));

  return (
    <Panel
      title="Properties"
      action={
        <button
          type="button"
          onClick={() => append({ ...emptyRow })}
          className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--brass)]/30 bg-[var(--brass)]/10 px-2.5 py-1 text-xs font-medium text-[var(--brass)] transition-colors hover:bg-[var(--brass)]/15"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          Add property
        </button>
      }
    >
      <p className="mb-4 text-xs text-[var(--slate)]">
        The first property is the deal’s primary location. Pick an existing property to avoid
        duplicates, add a new one, or leave this empty for an early first look.
      </p>

      {fields.length === 0 ? (
        <div className="rounded-md border border-dashed border-[var(--border)] bg-[var(--paper)] px-4 py-5 text-sm text-[var(--slate)]">
          No property attached yet.
        </div>
      ) : null}

      <div className="mt-4 space-y-4">
        {fields.map((field, index) => {
          const mode = watch(`properties.${index}.mode`);
          const propertyType = watch(`properties.${index}.property_type`);
          const unitsRequired = ['multifamily', 'self_storage', 'hotel'].includes(propertyType ?? '');
          const rowErrors = errors.properties?.[index];
          return (
            <div key={field.id} className="rounded-md border border-[var(--border)] bg-[var(--paper)] p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {index === 0 ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--brass)]">
                      <Star className="h-3 w-3 fill-current" strokeWidth={0} />
                      Primary
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-[var(--slate)]">
                      Property {index + 1}
                    </span>
                  )}
                  <ModeToggle
                    aria-label="Existing or new property"
                    value={mode}
                    onChange={(next) => setValue(`properties.${index}.mode`, next, { shouldValidate: false })}
                    options={[
                      { value: 'existing', label: 'Existing' },
                      { value: 'new', label: 'New' },
                    ]}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => remove(index)}
                  aria-label={`Remove property ${index + 1}`}
                  className="rounded-sm p-1 text-[var(--slate)] transition-colors hover:bg-[var(--ink)]/5 hover:text-[var(--ink)]"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                </button>
              </div>

              {mode === 'existing' ? (
                <FormField label="Property" error={rowErrors?.property_id?.message}>
                  <SelectNative
                    placeholder={propertiesQuery.isLoading ? 'Loading…' : 'Select a property'}
                    options={propertyOptions}
                    aria-invalid={Boolean(rowErrors?.property_id)}
                    {...register(`properties.${index}.property_id`)}
                  />
                </FormField>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Street address" required error={rowErrors?.address?.message} className="sm:col-span-2">
                    <Input aria-invalid={Boolean(rowErrors?.address)} {...register(`properties.${index}.address`)} />
                  </FormField>
                  <FormField label="City" required error={rowErrors?.city?.message}>
                    <Input aria-invalid={Boolean(rowErrors?.city)} {...register(`properties.${index}.city`)} />
                  </FormField>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField label="State" required error={rowErrors?.state?.message}>
                      <SelectNative
                        placeholder="—"
                        options={STATE_OPTIONS}
                        aria-invalid={Boolean(rowErrors?.state)}
                        {...register(`properties.${index}.state`)}
                      />
                    </FormField>
                    <FormField label="ZIP" required error={rowErrors?.zip?.message}>
                      <Input aria-invalid={Boolean(rowErrors?.zip)} {...register(`properties.${index}.zip`)} />
                    </FormField>
                  </div>
                  <FormField label="Property type" required error={rowErrors?.property_type?.message}>
                    <SelectNative
                      placeholder="Select type"
                      options={PROPERTY_TYPE_OPTIONS}
                      aria-invalid={Boolean(rowErrors?.property_type)}
                      {...register(`properties.${index}.property_type`)}
                    />
                  </FormField>
                  <FormField label="Subtype" hint="Optional">
                    <Input placeholder="e.g. Garden-style" {...register(`properties.${index}.subtype`)} />
                  </FormField>
                  <FormField
                    label="Units / keys"
                    hint={unitsRequired ? undefined : 'Optional'}
                    required={unitsRequired}
                    error={rowErrors?.units?.message}
                  >
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      aria-invalid={Boolean(rowErrors?.units)}
                      {...register(`properties.${index}.units`)}
                    />
                  </FormField>
                  <FormField label="Rentable square feet" hint="Optional" error={rowErrors?.rentable_square_feet?.message}>
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      aria-invalid={Boolean(rowErrors?.rentable_square_feet)}
                      {...register(`properties.${index}.rentable_square_feet`)}
                    />
                  </FormField>
                  <FormField label="Year built" hint="Optional" error={rowErrors?.year_built?.message}>
                    <Input
                      type="number"
                      min="1700"
                      max="2200"
                      step="1"
                      inputMode="numeric"
                      aria-invalid={Boolean(rowErrors?.year_built)}
                      {...register(`properties.${index}.year_built`)}
                    />
                  </FormField>
                  <FormField label="Year renovated" hint="Optional" error={rowErrors?.year_renovated?.message}>
                    <Input
                      type="number"
                      min="1700"
                      max="2200"
                      step="1"
                      inputMode="numeric"
                      aria-invalid={Boolean(rowErrors?.year_renovated)}
                      {...register(`properties.${index}.year_renovated`)}
                    />
                  </FormField>
                  <FormField label="County" hint="Optional">
                    <Input {...register(`properties.${index}.county`)} />
                  </FormField>
                  <FormField label="MSA" hint="Optional">
                    <Input {...register(`properties.${index}.msa`)} />
                  </FormField>
                  <FormField label="Number of buildings" hint="Optional" error={rowErrors?.number_of_buildings?.message}>
                    <Input type="number" min="0" step="1" {...register(`properties.${index}.number_of_buildings`)} />
                  </FormField>
                  <FormField label="Number of stories" hint="Optional" error={rowErrors?.number_of_stories?.message}>
                    <Input type="number" min="0" step="1" {...register(`properties.${index}.number_of_stories`)} />
                  </FormField>
                  <FormField label="Parking spaces" hint="Optional" error={rowErrors?.parking_spaces?.message}>
                    <Input type="number" min="0" step="1" {...register(`properties.${index}.parking_spaces`)} />
                  </FormField>
                  <FormField label="Lot size" hint="Acres · optional" error={rowErrors?.lot_size_acres?.message}>
                    <Input inputMode="decimal" {...register(`properties.${index}.lot_size_acres`)} />
                  </FormField>
                  <FormField label="Flood zone" hint="Optional">
                    <Input placeholder="e.g. X or AE" {...register(`properties.${index}.flood_zone`)} />
                  </FormField>
                  <FormField label="Zoning designation" hint="Optional">
                    <Input {...register(`properties.${index}.zoning_designation`)} />
                  </FormField>
                  <FormField label="Environmental status" hint="Optional" className="sm:col-span-2">
                    <SelectNative
                      placeholder="Unknown"
                      options={PROPERTY_ENVIRONMENTAL_STATUS_OPTIONS}
                      {...register(`properties.${index}.environmental_status`)}
                    />
                  </FormField>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {typeof errors.properties?.message === 'string' ? (
        <p className="mt-2 text-xs text-red-600">{errors.properties.message}</p>
      ) : null}
    </Panel>
  );
}
