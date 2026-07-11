import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Save, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNative } from '@/components/ui/select-native';
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
}

interface SponsorFactErrors {
  website?: string;
  years_experience?: string;
  completed_projects?: string;
}

export function SponsorFactsDialog({
  sponsor,
  open,
  onOpenChange,
}: SponsorFactsDialogProps) {
  const updateSponsor = useUpdateSponsor(sponsor.id);
  const [website, setWebsite] = useState('');
  const [yearsExperience, setYearsExperience] = useState('');
  const [completedProjects, setCompletedProjects] = useState('');
  const [bankruptcyHistory, setBankruptcyHistory] = useState('');
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
    setErrors({});
    setBanner(null);
  }, [open, sponsor]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors: SponsorFactErrors = {};
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
    setErrors(nextErrors);
    setBanner(null);
    if (Object.keys(nextErrors).length) return;

    const payload: UpdateSponsorFactsPayload = {
      website: normalizedWebsite,
      years_experience: optionalNumber(yearsExperience),
      completed_projects: optionalNumber(completedProjects),
      bankruptcy_history:
        bankruptcyHistory === '' ? null : bankruptcyHistory === 'yes',
    };
    updateSponsor.mutate(payload, {
      onSuccess: () => onOpenChange(false),
      onError: (error) => {
        const fields = fieldErrors(error);
        const fieldState: SponsorFactErrors = {
          website: fields.website,
          years_experience: fields.years_experience,
          completed_projects: fields.completed_projects,
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
                Update underwriting facts for {sponsor.entity_name}. Identity, contacts, and relationship rating remain unchanged.
              </Dialog.Description>
            </div>
            <Dialog.Close aria-label="Close sponsor facts dialog" className="rounded-sm p-1 text-[var(--slate)] hover:text-[var(--ink)]">
              <X className="h-4 w-4" strokeWidth={1.75} />
            </Dialog.Close>
          </div>

          <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
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
