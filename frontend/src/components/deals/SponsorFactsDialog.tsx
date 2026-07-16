import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Save, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNative } from '@/components/ui/select-native';
import { Textarea } from '@/components/ui/textarea';
import {
  RELATIONSHIP_RATING_OPTIONS,
  SPONSOR_CONNECTION_OPTIONS,
  SPONSOR_ENTITY_TYPE_OPTIONS,
} from '@/components/deals/form/options';
import { useUpdateSponsor, type UpdateSponsorFactsPayload } from '@/lib/api/deals';
import { apiErrorMessage, fieldErrors } from '@/lib/apiError';
import {
  isOptionalHttpUrl,
  isOptionalWholeNumber,
  optionalNumber,
} from '@/lib/formValidation';
import type { Sponsor } from '@/types/deal';

interface SponsorFactsDialogProps {
  sponsor: Sponsor;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canEditIdentity?: boolean;
}

interface SponsorFactErrors {
  website?: string;
  years_experience?: string;
  completed_projects?: string;
  entity_name?: string;
  primary_contact_name?: string;
  primary_contact_email?: string;
  total_units_owned?: string;
  total_sf_managed?: string;
  assets_under_management?: string;
}

export function SponsorFactsDialog({
  sponsor,
  open,
  onOpenChange,
  canEditIdentity = false,
}: SponsorFactsDialogProps) {
  const updateSponsor = useUpdateSponsor(sponsor.id);
  const [entityName, setEntityName] = useState('');
  const [entityType, setEntityType] = useState<Sponsor['entity_type']>('llc');
  const [primaryContactName, setPrimaryContactName] = useState('');
  const [primaryContactEmail, setPrimaryContactEmail] = useState('');
  const [primaryContactPhone, setPrimaryContactPhone] = useState('');
  const [relationshipRating, setRelationshipRating] = useState<Sponsor['relationship_rating']>('new');
  const [website, setWebsite] = useState('');
  const [yearsExperience, setYearsExperience] = useState('');
  const [completedProjects, setCompletedProjects] = useState('');
  const [bankruptcyHistory, setBankruptcyHistory] = useState('');
  const [businessAddress, setBusinessAddress] = useState('');
  const [totalUnitsOwned, setTotalUnitsOwned] = useState('');
  const [totalSfManaged, setTotalSfManaged] = useState('');
  const [assetsUnderManagement, setAssetsUnderManagement] = useState('');
  const [connectionSource, setConnectionSource] = useState<Sponsor['connection_source']>('');
  const [errors, setErrors] = useState<SponsorFactErrors>({});
  const [banner, setBanner] = useState<string | null>(null);
  const initializedSponsorId = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      initializedSponsorId.current = null;
      return;
    }
    if (initializedSponsorId.current === sponsor.id) return;
    initializedSponsorId.current = sponsor.id;
    setEntityName(sponsor.entity_name);
    setEntityType(sponsor.entity_type);
    setPrimaryContactName(sponsor.primary_contact_name);
    setPrimaryContactEmail(sponsor.primary_contact_email);
    setPrimaryContactPhone(sponsor.primary_contact_phone ?? '');
    setRelationshipRating(sponsor.relationship_rating);
    setWebsite(sponsor.website ?? '');
    setYearsExperience(sponsor.years_experience?.toString() ?? '');
    setCompletedProjects(sponsor.completed_projects?.toString() ?? '');
    setBankruptcyHistory(
      sponsor.bankruptcy_history === null
        ? ''
        : sponsor.bankruptcy_history
          ? 'yes'
          : 'no',
    );
    setBusinessAddress(sponsor.business_address ?? '');
    setTotalUnitsOwned(sponsor.total_units_owned?.toString() ?? '');
    setTotalSfManaged(sponsor.total_sf_managed?.toString() ?? '');
    setAssetsUnderManagement(sponsor.assets_under_management ?? '');
    setConnectionSource(sponsor.connection_source ?? '');
    setErrors({});
    setBanner(null);
  }, [open, sponsor]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors: SponsorFactErrors = {};
    if (canEditIdentity) {
      if (!entityName.trim()) nextErrors.entity_name = 'Entity name is required';
      if (!primaryContactName.trim()) nextErrors.primary_contact_name = 'Primary contact is required';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(primaryContactEmail.trim())) {
        nextErrors.primary_contact_email = 'Enter a valid email address';
      }
    }
    const normalizedWebsite = website.trim();
    if (!isOptionalHttpUrl(normalizedWebsite)) {
      nextErrors.website = 'Enter a URL beginning with http:// or https://';
    }
    if (!isOptionalWholeNumber(yearsExperience, 200)) {
      nextErrors.years_experience = 'Enter a whole number from 0 to 200';
    }
    if (!isOptionalWholeNumber(completedProjects)) {
      nextErrors.completed_projects = 'Enter zero or a positive whole number';
    }
    if (!isOptionalWholeNumber(totalUnitsOwned)) {
      nextErrors.total_units_owned = 'Enter zero or a positive whole number';
    }
    if (!isOptionalWholeNumber(totalSfManaged)) {
      nextErrors.total_sf_managed = 'Enter zero or a positive whole number';
    }
    if (assetsUnderManagement.trim() && !/^\d+(?:\.\d{1,2})?$/.test(assetsUnderManagement.trim())) {
      nextErrors.assets_under_management = 'Enter a nonnegative amount with no more than 2 decimal places';
    }
    setErrors(nextErrors);
    setBanner(null);
    if (Object.keys(nextErrors).length) return;

    const payload: UpdateSponsorFactsPayload = {};
    const add = <K extends keyof UpdateSponsorFactsPayload>(
      key: K,
      value: UpdateSponsorFactsPayload[K],
      current: UpdateSponsorFactsPayload[K],
    ) => {
      if (value !== current) payload[key] = value;
    };
    if (canEditIdentity) {
      add('entity_name', entityName.trim(), sponsor.entity_name);
      add('entity_type', entityType, sponsor.entity_type);
      add('primary_contact_name', primaryContactName.trim(), sponsor.primary_contact_name);
      add('primary_contact_email', primaryContactEmail.trim(), sponsor.primary_contact_email);
      add('primary_contact_phone', primaryContactPhone.trim(), sponsor.primary_contact_phone ?? '');
      add('relationship_rating', relationshipRating, sponsor.relationship_rating);
    }
    add('website', normalizedWebsite, sponsor.website ?? '');
    add('years_experience', optionalNumber(yearsExperience), sponsor.years_experience);
    add('completed_projects', optionalNumber(completedProjects), sponsor.completed_projects);
    add(
      'bankruptcy_history',
      bankruptcyHistory === '' ? null : bankruptcyHistory === 'yes',
      sponsor.bankruptcy_history,
    );
    add('business_address', businessAddress.trim(), sponsor.business_address ?? '');
    add('total_units_owned', optionalNumber(totalUnitsOwned), sponsor.total_units_owned ?? null);
    add('total_sf_managed', optionalNumber(totalSfManaged), sponsor.total_sf_managed ?? null);
    add('assets_under_management', assetsUnderManagement.trim() || null, sponsor.assets_under_management ?? null);
    add('connection_source', connectionSource, sponsor.connection_source ?? '');
    if (!Object.keys(payload).length) {
      onOpenChange(false);
      return;
    }
    updateSponsor.mutate(payload, {
      onSuccess: () => onOpenChange(false),
      onError: (error) => {
        const fields = fieldErrors(error);
        const fieldState: SponsorFactErrors = {
          website: fields.website,
          years_experience: fields.years_experience,
          completed_projects: fields.completed_projects,
          entity_name: fields.entity_name,
          primary_contact_name: fields.primary_contact_name,
          primary_contact_email: fields.primary_contact_email,
          total_units_owned: fields.total_units_owned,
          total_sf_managed: fields.total_sf_managed,
          assets_under_management: fields.assets_under_management,
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
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(480px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--paper-elevated)] p-6 shadow-2xl focus:outline-none">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Dialog.Title className="font-display text-lg font-medium text-[var(--ink)]">
                Edit sponsor facts
              </Dialog.Title>
              <Dialog.Description className="mt-1 break-words text-sm text-[var(--slate)]">
                {canEditIdentity
                  ? 'Update identity, relationship, and underwriting facts for this sponsor.'
                  : 'Update underwriting facts for this sponsor.'}
              </Dialog.Description>
            </div>
            <Dialog.Close aria-label="Close sponsor facts dialog" className="rounded-sm p-1 text-[var(--slate)] hover:text-[var(--ink)]">
              <X className="h-4 w-4" strokeWidth={1.75} />
            </Dialog.Close>
          </div>

          <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
            {canEditIdentity ? <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Entity name" required error={errors.entity_name}>
                <Input value={entityName} onChange={(event) => setEntityName(event.target.value)} />
              </FormField>
              <FormField label="Entity type" required>
                <SelectNative options={SPONSOR_ENTITY_TYPE_OPTIONS} value={entityType} onChange={(event) => setEntityType(event.target.value as Sponsor['entity_type'])} />
              </FormField>
              <FormField label="Primary contact" required error={errors.primary_contact_name}>
                <Input value={primaryContactName} onChange={(event) => setPrimaryContactName(event.target.value)} />
              </FormField>
              <FormField label="Contact email" required error={errors.primary_contact_email}>
                <Input type="email" value={primaryContactEmail} onChange={(event) => setPrimaryContactEmail(event.target.value)} />
              </FormField>
              <FormField label="Contact phone" hint="Optional">
                <Input value={primaryContactPhone} onChange={(event) => setPrimaryContactPhone(event.target.value)} />
              </FormField>
              <FormField label="Relationship">
                <SelectNative options={RELATIONSHIP_RATING_OPTIONS} value={relationshipRating} onChange={(event) => setRelationshipRating(event.target.value as Sponsor['relationship_rating'])} />
              </FormField>
            </div> : null}
            <FormField label="Website" hint="Optional" error={errors.website}>
              <Input
                type="url"
                placeholder="https://"
                value={website}
                aria-invalid={Boolean(errors.website)}
                onChange={(event) => setWebsite(event.target.value)}
              />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Years of experience" hint="Optional" error={errors.years_experience}>
                <Input
                  type="number"
                  min="0"
                  max="200"
                  step="1"
                  value={yearsExperience}
                  aria-invalid={Boolean(errors.years_experience)}
                  onChange={(event) => setYearsExperience(event.target.value)}
                />
              </FormField>
              <FormField label="Completed projects" hint="Optional" error={errors.completed_projects}>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  value={completedProjects}
                  aria-invalid={Boolean(errors.completed_projects)}
                  onChange={(event) => setCompletedProjects(event.target.value)}
                />
              </FormField>
            </div>
            <FormField label="Bankruptcy history" hint="Optional">
              <SelectNative
                placeholder="Unknown"
                options={[{ value: 'no', label: 'No' }, { value: 'yes', label: 'Yes' }]}
                value={bankruptcyHistory}
                onChange={(event) => setBankruptcyHistory(event.target.value)}
              />
            </FormField>
            <FormField label="Business address" hint="Optional">
              <Textarea rows={2} value={businessAddress} onChange={(event) => setBusinessAddress(event.target.value)} />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Units currently owned" hint="Optional" error={errors.total_units_owned}>
                <Input type="number" min="0" step="1" value={totalUnitsOwned} onChange={(event) => setTotalUnitsOwned(event.target.value)} />
              </FormField>
              <FormField label="Square feet managed" hint="Optional" error={errors.total_sf_managed}>
                <Input type="number" min="0" step="1" value={totalSfManaged} onChange={(event) => setTotalSfManaged(event.target.value)} />
              </FormField>
              <FormField label="Assets under management" hint="Optional" error={errors.assets_under_management}>
                <Input inputMode="decimal" value={assetsUnderManagement} onChange={(event) => setAssetsUnderManagement(event.target.value)} />
              </FormField>
              <FormField label="How we connected" hint="Optional">
                <SelectNative placeholder="Unknown" options={SPONSOR_CONNECTION_OPTIONS} value={connectionSource} onChange={(event) => setConnectionSource(event.target.value as Sponsor['connection_source'])} />
              </FormField>
            </div>

            {banner ? <p role="alert" className="text-sm text-red-600">{banner}</p> : null}
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={updateSponsor.isPending}>
                <Save className="h-4 w-4" strokeWidth={1.75} />
                {updateSponsor.isPending ? 'Saving…' : 'Save sponsor facts'}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
