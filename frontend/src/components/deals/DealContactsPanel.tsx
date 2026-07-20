import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { AlertTriangle, Mail, Pencil, Phone, Plus, Trash2, UserPlus, X } from 'lucide-react';

import { Panel } from '@/components/deals/Panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { SelectNative } from '@/components/ui/select-native';
import { Textarea } from '@/components/ui/textarea';
import {
  ContactCreatedButUnlinkedError,
  useCreateAndLinkContact,
  useCreateDealContactLink,
  useDealContacts,
  useDeleteDealContact,
  useUpdateContact,
  useUpdateDealContact,
} from '@/lib/api/contacts';
import { apiErrorMessage, fieldErrors } from '@/lib/apiError';
import {
  DEAL_CONTACT_ROLE_LABELS,
  type Contact,
  type CreateAndLinkContactPayload,
  type DealContact,
  type DealContactRole,
} from '@/types/contact';

interface ContactFormValues {
  full_name: string;
  title: string;
  company_name: string;
  email: string;
  phone: string;
  role: DealContactRole;
  is_primary: boolean;
  notes: string;
}

const ROLE_OPTIONS = (Object.entries(DEAL_CONTACT_ROLE_LABELS) as [DealContactRole, string][]).map(
  ([value, label]) => ({ value, label }),
);

const SERVER_FIELD_TO_FORM: Record<string, keyof ContactFormValues> = {
  full_name: 'full_name',
  title: 'title',
  company_name: 'company_name',
  email: 'email',
  phone: 'phone',
  role: 'role',
  is_primary: 'is_primary',
  notes: 'notes',
};

function initialValues(): ContactFormValues {
  return {
    full_name: '',
    title: '',
    company_name: '',
    email: '',
    phone: '',
    role: 'source_contact',
    is_primary: false,
    notes: '',
  };
}

function personPayload(values: ContactFormValues): CreateAndLinkContactPayload {
  return {
    contact: {
      full_name: values.full_name.trim(),
      title: values.title.trim(),
      company_name: values.company_name.trim(),
      email: values.email.trim(),
      phone: values.phone.trim(),
    },
    role: values.role,
    is_primary: values.is_primary,
    notes: values.notes.trim(),
  };
}

export function DealContactsPanel({ dealId }: { dealId: string }) {
  const contactsQuery = useDealContacts(dealId);
  const createAndLink = useCreateAndLinkContact(dealId);
  const retryLink = useCreateDealContactLink(dealId);
  const updateContact = useUpdateContact(dealId);
  const updateLink = useUpdateDealContact(dealId);
  const deleteLink = useDeleteDealContact(dealId);
  const [formOpen, setFormOpen] = useState(false);
  const [savedButUnlinked, setSavedButUnlinked] = useState<Contact | null>(null);
  const [editingLink, setEditingLink] = useState<DealContact | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const form = useForm<ContactFormValues>({ defaultValues: initialValues() });
  const { register, handleSubmit, reset, setError, clearErrors, formState } = form;
  const errors = formState.errors;

  const isSaving = createAndLink.isPending || retryLink.isPending || updateContact.isPending || updateLink.isPending;
  const contactFieldsLocked = Boolean(savedButUnlinked);

  const openForm = () => {
    reset(initialValues());
    setSavedButUnlinked(null);
    setEditingLink(null);
    setBanner(null);
    setNotice(null);
    setFormOpen(true);
  };

  const openEdit = (link: DealContact) => {
    const contact = link.contact_detail;
    reset({
      full_name: contact.full_name,
      title: contact.title,
      company_name: contact.company_name,
      email: contact.email,
      phone: contact.phone,
      role: link.role,
      is_primary: link.is_primary,
      notes: link.notes,
    });
    setSavedButUnlinked(null);
    setEditingLink(link);
    setBanner(null);
    setNotice(null);
    setFormOpen(true);
  };

  const closeForm = () => {
    reset(initialValues());
    setSavedButUnlinked(null);
    setEditingLink(null);
    setBanner(null);
    setFormOpen(false);
  };

  const surfaceError = (error: unknown) => {
    const serverErrors = fieldErrors(error);
    let mapped = false;
    for (const [field, message] of Object.entries(serverErrors)) {
      const formField = SERVER_FIELD_TO_FORM[field];
      if (formField) {
        setError(formField, { message });
        mapped = true;
      }
    }
    setBanner(mapped ? 'Please fix the highlighted fields.' : apiErrorMessage(error));
  };

  const onSubmit = async (values: ContactFormValues) => {
    clearErrors();
    setBanner(null);
    setNotice(null);
    try {
      if (editingLink) {
        await updateContact.mutateAsync({
          contactId: editingLink.contact,
          payload: personPayload(values).contact,
        });
        await updateLink.mutateAsync({
          linkId: editingLink.id,
          payload: { is_primary: values.is_primary, notes: values.notes.trim() },
        });
        setNotice(`${values.full_name.trim()} updated.`);
      } else if (savedButUnlinked) {
        await retryLink.mutateAsync({
          contact: savedButUnlinked.id,
          role: values.role,
          is_primary: values.is_primary,
          notes: values.notes.trim(),
        });
        setNotice(`${savedButUnlinked.full_name} linked to this deal.`);
      } else {
        await createAndLink.mutateAsync(personPayload(values));
        setNotice(`${values.full_name.trim()} added to this deal.`);
      }
      reset(initialValues());
      setSavedButUnlinked(null);
      setEditingLink(null);
      setFormOpen(false);
    } catch (error) {
      if (error instanceof ContactCreatedButUnlinkedError) {
        setSavedButUnlinked(error.contact);
        surfaceError(error.linkError);
        return;
      }
      surfaceError(error);
    }
  };

  const links = contactsQuery.data ?? [];

  return (
    <Panel
      title="Contacts"
      count={links.length}
      action={
        !formOpen ? (
          <Button type="button" variant="outline" size="sm" onClick={openForm}>
            <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
            Add person
          </Button>
        ) : null
      }
    >
      {contactsQuery.isLoading ? (
        <p aria-live="polite" className="text-sm text-[var(--slate)]">Loading contacts…</p>
      ) : contactsQuery.isError ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--slate)]">
          <p>Contacts could not be loaded.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void contactsQuery.refetch()}>
            Try again
          </Button>
        </div>
      ) : links.length === 0 ? (
        <p className="text-sm text-[var(--slate)]">No contacts have been linked to this deal.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {links.map((link) => (
            <ContactRow
              key={link.id}
              link={link}
              onEdit={() => openEdit(link)}
              onRemove={() => {
                if (!window.confirm(`Remove ${link.contact_detail.full_name} from this deal?`)) return;
                deleteLink.mutate(link.id, {
                  onSuccess: () => setNotice(`${link.contact_detail.full_name} removed from this deal.`),
                  onError: (error) => setBanner(apiErrorMessage(error, 'Could not remove contact.')),
                });
              }}
            />
          ))}
        </ul>
      )}

      {notice ? (
        <p aria-live="polite" className="mt-4 text-sm text-[var(--brass)]">{notice}</p>
      ) : null}

      {formOpen ? (
        <form onSubmit={(event) => void handleSubmit(onSubmit)(event)} className="mt-5 border-t border-[var(--border)] pt-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h3 className="font-display text-base font-medium text-[var(--ink)]">
                {editingLink ? 'Edit deal contact' : savedButUnlinked ? 'Finish linking contact' : 'Add deal contact'}
              </h3>
              <p className="mt-1 text-xs text-[var(--slate)]">
                {editingLink
                  ? 'Update the reusable person and this deal-specific primary setting or notes.'
                  : savedButUnlinked
                  ? `${savedButUnlinked.full_name} is saved. Adjust the deal role or primary setting, then retry.`
                  : 'Create a reusable person, then link them to this deal.'}
              </p>
            </div>
            <button
              type="button"
              onClick={closeForm}
              className="rounded-sm p-1 text-[var(--slate)] transition-colors hover:bg-[var(--ink)]/5 hover:text-[var(--ink)]"
              aria-label="Close contact form"
            >
              <X className="h-4 w-4" strokeWidth={1.75} />
            </button>
          </div>

          {banner ? (
            <div role="alert" className="mb-4 flex items-start gap-2 rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} />
              <p>{banner}</p>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Full name" htmlFor="deal-contact-full-name" required error={errors.full_name?.message}>
              <Input
                id="deal-contact-full-name"
                required
                disabled={contactFieldsLocked || isSaving}
                autoComplete="name"
                aria-invalid={Boolean(errors.full_name)}
                {...register('full_name', { required: 'Full name is required' })}
              />
            </FormField>
            <FormField label="Title" htmlFor="deal-contact-title" error={errors.title?.message}>
              <Input
                id="deal-contact-title"
                disabled={contactFieldsLocked || isSaving}
                autoComplete="organization-title"
                aria-invalid={Boolean(errors.title)}
                {...register('title')}
              />
            </FormField>
            <FormField label="Company" htmlFor="deal-contact-company" error={errors.company_name?.message}>
              <Input
                id="deal-contact-company"
                disabled={contactFieldsLocked || isSaving}
                autoComplete="organization"
                aria-invalid={Boolean(errors.company_name)}
                {...register('company_name')}
              />
            </FormField>
            <FormField label="Email" htmlFor="deal-contact-email" error={errors.email?.message}>
              <Input
                id="deal-contact-email"
                type="email"
                disabled={contactFieldsLocked || isSaving}
                autoComplete="email"
                aria-invalid={Boolean(errors.email)}
                {...register('email', {
                  validate: (value) =>
                    !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || 'Enter a valid email address',
                })}
              />
            </FormField>
            <FormField label="Phone" htmlFor="deal-contact-phone" error={errors.phone?.message}>
              <Input
                id="deal-contact-phone"
                type="tel"
                disabled={contactFieldsLocked || isSaving}
                autoComplete="tel"
                aria-invalid={Boolean(errors.phone)}
                {...register('phone')}
              />
            </FormField>
            <FormField label="Role" htmlFor="deal-contact-role" required error={errors.role?.message}>
              <SelectNative
                id="deal-contact-role"
                options={ROLE_OPTIONS}
                disabled={isSaving || Boolean(editingLink)}
                aria-invalid={Boolean(errors.role)}
                {...register('role', { required: 'Select a deal role' })}
              />
            </FormField>
            <FormField label="Link notes" htmlFor="deal-contact-notes" className="sm:col-span-2" error={errors.notes?.message}>
              <Textarea
                id="deal-contact-notes"
                rows={3}
                disabled={isSaving}
                placeholder="Optional internal context for this contact's role"
                aria-invalid={Boolean(errors.notes)}
                {...register('notes')}
              />
            </FormField>
            <div className="sm:col-span-2">
              <label htmlFor="deal-contact-primary" className="inline-flex items-center gap-2 text-sm text-[var(--ink)]">
                <input
                  id="deal-contact-primary"
                  type="checkbox"
                  disabled={isSaving}
                  className="h-4 w-4 rounded border-[var(--border)] accent-[var(--brass)]"
                  {...register('is_primary')}
                />
                Primary contact for this role
              </label>
              {errors.is_primary?.message ? <p className="mt-1.5 text-xs text-red-600">{errors.is_primary.message}</p> : null}
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Button type="button" variant="outline" disabled={isSaving} onClick={closeForm}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              <UserPlus className="h-4 w-4" strokeWidth={1.75} />
              {isSaving ? 'Saving…' : editingLink ? 'Save contact' : savedButUnlinked ? 'Retry link' : 'Add contact'}
            </Button>
          </div>
        </form>
      ) : null}
    </Panel>
  );
}

function ContactRow({
  link,
  onEdit,
  onRemove,
}: {
  link: DealContact;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const contact = link.contact_detail;
  const descriptor = [contact.title, contact.company_name].filter(Boolean).join(' · ');

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-[var(--ink)]">{contact.full_name}</p>
          {descriptor ? <p className="mt-0.5 text-sm text-[var(--slate)]">{descriptor}</p> : null}
        </div>
        <div className="flex flex-wrap justify-end gap-1.5">
          <Badge className="border-[var(--border)] bg-[var(--paper)] text-[var(--slate)]">
            {DEAL_CONTACT_ROLE_LABELS[link.role]}
          </Badge>
          {link.is_primary ? (
            <Badge className="border-[var(--brass)]/35 bg-[var(--brass)]/12 text-[var(--ink)]">Primary</Badge>
          ) : null}
          <Button type="button" variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${contact.full_name}`}>
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onRemove} aria-label={`Remove ${contact.full_name}`}>
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          </Button>
        </div>
      </div>
      {contact.email || contact.phone ? (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--slate)]">
          {contact.email ? (
            <a className="inline-flex items-center gap-1 hover:text-[var(--ink)]" href={`mailto:${contact.email}`}>
              <Mail className="h-3.5 w-3.5" strokeWidth={1.75} />
              {contact.email}
            </a>
          ) : null}
          {contact.phone ? (
            <a className="inline-flex items-center gap-1 hover:text-[var(--ink)]" href={`tel:${contact.phone}`}>
              <Phone className="h-3.5 w-3.5" strokeWidth={1.75} />
              {contact.phone}
            </a>
          ) : null}
        </div>
      ) : null}
      {link.notes ? <p className="mt-2 text-sm text-[var(--slate)]">{link.notes}</p> : null}
    </li>
  );
}
