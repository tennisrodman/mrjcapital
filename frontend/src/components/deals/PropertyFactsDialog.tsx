import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Save, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNative } from '@/components/ui/select-native';
import {
  PROPERTY_ENVIRONMENTAL_STATUS_OPTIONS,
  PROPERTY_TYPE_OPTIONS,
  STATE_OPTIONS,
} from '@/components/deals/form/options';
import { useUpdateProperty, type UpdatePropertyFactsPayload } from '@/lib/api/deals';
import { apiErrorMessage, fieldErrors } from '@/lib/apiError';
import { isOptionalWholeNumber, isOptionalYear, optionalNumber } from '@/lib/formValidation';
import type { Property } from '@/types/deal';

interface PropertyFactsDialogProps {
  property: Property;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEditIdentity?: boolean;
}

type PropertyFactField = keyof UpdatePropertyFactsPayload;
type PropertyFactErrors = Partial<Record<PropertyFactField, string>>;

export function PropertyFactsDialog({
  property,
  open,
  onOpenChange,
  canEditIdentity = false,
}: PropertyFactsDialogProps) {
  const updateProperty = useUpdateProperty(property.id);
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [zip, setZip] = useState('');
  const [propertyType, setPropertyType] = useState<Property['property_type']>('other');
  const [subtype, setSubtype] = useState('');
  const [units, setUnits] = useState('');
  const [rentableSquareFeet, setRentableSquareFeet] = useState('');
  const [yearBuilt, setYearBuilt] = useState('');
  const [yearRenovated, setYearRenovated] = useState('');
  const [county, setCounty] = useState('');
  const [msa, setMsa] = useState('');
  const [numberOfBuildings, setNumberOfBuildings] = useState('');
  const [numberOfStories, setNumberOfStories] = useState('');
  const [parkingSpaces, setParkingSpaces] = useState('');
  const [lotSizeAcres, setLotSizeAcres] = useState('');
  const [floodZone, setFloodZone] = useState('');
  const [zoningDesignation, setZoningDesignation] = useState('');
  const [environmentalStatus, setEnvironmentalStatus] = useState<Property['environmental_status']>('');
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
    setAddress(property.address);
    setCity(property.city);
    setState(property.state);
    setZip(property.zip);
    setPropertyType(property.property_type);
    setSubtype(property.subtype ?? '');
    setUnits(property.units?.toString() ?? '');
    setRentableSquareFeet(property.rentable_square_feet?.toString() ?? '');
    setYearBuilt(property.year_built?.toString() ?? '');
    setYearRenovated(property.year_renovated?.toString() ?? '');
    setCounty(property.county ?? '');
    setMsa(property.msa ?? '');
    setNumberOfBuildings(property.number_of_buildings?.toString() ?? '');
    setNumberOfStories(property.number_of_stories?.toString() ?? '');
    setParkingSpaces(property.parking_spaces?.toString() ?? '');
    setLotSizeAcres(property.lot_size_acres ?? '');
    setFloodZone(property.flood_zone ?? '');
    setZoningDesignation(property.zoning_designation ?? '');
    setEnvironmentalStatus(property.environmental_status ?? '');
    setErrors({});
    setBanner(null);
  }, [open, property]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors: PropertyFactErrors = {};
    if (canEditIdentity) {
      if (!address.trim()) nextErrors.address = 'Street address is required';
      if (!city.trim()) nextErrors.city = 'City is required';
      if (!state.trim()) nextErrors.state = 'State is required';
      if (!zip.trim()) nextErrors.zip = 'ZIP is required';
    }
    if (!isOptionalWholeNumber(units)) nextErrors.units = 'Enter zero or a positive whole number';
    if (!isOptionalWholeNumber(rentableSquareFeet)) {
      nextErrors.rentable_square_feet = 'Enter zero or a positive whole number';
    }
    for (const [field, value] of [
      ['number_of_buildings', numberOfBuildings],
      ['number_of_stories', numberOfStories],
      ['parking_spaces', parkingSpaces],
    ] as const) {
      if (!isOptionalWholeNumber(value)) nextErrors[field] = 'Enter zero or a positive whole number';
    }
    if (lotSizeAcres.trim() && !/^\d+(?:\.\d{1,4})?$/.test(lotSizeAcres.trim())) {
      nextErrors.lot_size_acres = 'Enter nonnegative acreage with no more than 4 decimal places';
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

    const payload: UpdatePropertyFactsPayload = {};
    const add = <K extends keyof UpdatePropertyFactsPayload>(
      key: K,
      value: UpdatePropertyFactsPayload[K],
      current: UpdatePropertyFactsPayload[K],
    ) => {
      if (value !== current) payload[key] = value;
    };
    if (canEditIdentity) {
      add('address', address.trim(), property.address);
      add('city', city.trim(), property.city);
      add('state', state, property.state);
      add('zip', zip.trim(), property.zip);
      add('property_type', propertyType, property.property_type);
    }
    add('subtype', subtype.trim(), property.subtype ?? '');
    add('units', optionalNumber(units), property.units);
    add('rentable_square_feet', optionalNumber(rentableSquareFeet), property.rentable_square_feet);
    add('year_built', built, property.year_built);
    add('year_renovated', renovated, property.year_renovated);
    add('county', county.trim(), property.county ?? '');
    add('msa', msa.trim(), property.msa ?? '');
    add('number_of_buildings', optionalNumber(numberOfBuildings), property.number_of_buildings ?? null);
    add('number_of_stories', optionalNumber(numberOfStories), property.number_of_stories ?? null);
    add('parking_spaces', optionalNumber(parkingSpaces), property.parking_spaces ?? null);
    add('lot_size_acres', lotSizeAcres.trim() || null, property.lot_size_acres ?? null);
    add('flood_zone', floodZone.trim(), property.flood_zone ?? '');
    add('zoning_designation', zoningDesignation.trim(), property.zoning_designation ?? '');
    add('environmental_status', environmentalStatus, property.environmental_status ?? '');
    if (!Object.keys(payload).length) {
      onOpenChange(false);
      return;
    }
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
          address: fields.address,
          city: fields.city,
          state: fields.state,
          zip: fields.zip,
          property_type: fields.property_type,
          msa: fields.msa,
          number_of_buildings: fields.number_of_buildings,
          number_of_stories: fields.number_of_stories,
          parking_spaces: fields.parking_spaces,
          lot_size_acres: fields.lot_size_acres,
          flood_zone: fields.flood_zone,
          zoning_designation: fields.zoning_designation,
          environmental_status: fields.environmental_status,
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
                {canEditIdentity
                  ? 'Correct the property identity and maintain its underwriting facts.'
                  : 'Maintain underwriting facts for this property.'}
              </Dialog.Description>
            </div>
            <Dialog.Close aria-label="Close property facts dialog" className="rounded-sm p-1 text-[var(--slate)] hover:text-[var(--ink)]">
              <X className="h-4 w-4" strokeWidth={1.75} />
            </Dialog.Close>
          </div>

          <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
            <div className="grid gap-4 sm:grid-cols-2">
              {canEditIdentity ? <>
              <FormField label="Street address" required error={errors.address} className="sm:col-span-2">
                <Input value={address} onChange={(event) => setAddress(event.target.value)} />
              </FormField>
              <FormField label="City" required error={errors.city}>
                <Input value={city} onChange={(event) => setCity(event.target.value)} />
              </FormField>
              <div className="grid grid-cols-2 gap-4">
                <FormField label="State" required error={errors.state}>
                  <SelectNative options={STATE_OPTIONS} value={state} onChange={(event) => setState(event.target.value)} />
                </FormField>
                <FormField label="ZIP" required error={errors.zip}>
                  <Input value={zip} onChange={(event) => setZip(event.target.value)} />
                </FormField>
              </div>
              <FormField label="Property type" required error={errors.property_type}>
                <SelectNative options={PROPERTY_TYPE_OPTIONS} value={propertyType} onChange={(event) => setPropertyType(event.target.value as Property['property_type'])} />
              </FormField>
              </> : null}
              <FormField label="Subtype" hint="Optional">
                <Input value={subtype} onChange={(event) => setSubtype(event.target.value)} />
              </FormField>
              <FormField label="County" hint="Optional">
                <Input value={county} onChange={(event) => setCounty(event.target.value)} />
              </FormField>
              <FormField label="MSA" hint="Optional">
                <Input value={msa} onChange={(event) => setMsa(event.target.value)} />
              </FormField>
              <FormField label="Number of buildings" hint="Optional" error={errors.number_of_buildings}>
                <Input type="number" min="0" step="1" value={numberOfBuildings} onChange={(event) => setNumberOfBuildings(event.target.value)} />
              </FormField>
              <FormField label="Number of stories" hint="Optional" error={errors.number_of_stories}>
                <Input type="number" min="0" step="1" value={numberOfStories} onChange={(event) => setNumberOfStories(event.target.value)} />
              </FormField>
              <FormField label="Parking spaces" hint="Optional" error={errors.parking_spaces}>
                <Input type="number" min="0" step="1" value={parkingSpaces} onChange={(event) => setParkingSpaces(event.target.value)} />
              </FormField>
              <FormField label="Lot size" hint="Acres · optional" error={errors.lot_size_acres}>
                <Input inputMode="decimal" value={lotSizeAcres} onChange={(event) => setLotSizeAcres(event.target.value)} />
              </FormField>
              <FormField label="Flood zone" hint="Optional">
                <Input value={floodZone} onChange={(event) => setFloodZone(event.target.value)} />
              </FormField>
              <FormField label="Zoning designation" hint="Optional">
                <Input value={zoningDesignation} onChange={(event) => setZoningDesignation(event.target.value)} />
              </FormField>
              <FormField label="Environmental status" hint="Optional" className="sm:col-span-2">
                <SelectNative placeholder="Unknown" options={PROPERTY_ENVIRONMENTAL_STATUS_OPTIONS} value={environmentalStatus} onChange={(event) => setEnvironmentalStatus(event.target.value as Property['environmental_status'])} />
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
