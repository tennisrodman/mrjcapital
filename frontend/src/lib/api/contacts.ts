import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiRequest } from '@/config/api';
import { fetchAllPages } from '@/lib/api/pagination';
import type {
  Contact,
  CreateAndLinkContactPayload,
  CreateContactPayload,
  CreateDealContactPayload,
  DealContact,
} from '@/types/contact';

const dealContactsQueryKey = (dealId: string) => ['deal-contacts', dealId] as const;

function invalidateDealContactData(
  queryClient: ReturnType<typeof useQueryClient>,
  dealId: string,
) {
  void queryClient.invalidateQueries({ queryKey: dealContactsQueryKey(dealId) });
  void queryClient.invalidateQueries({ queryKey: ['deal-activity', dealId] });
}

function ordered(links: DealContact[]): DealContact[] {
  return [...links].sort((a, b) => {
    const byRole = a.role.localeCompare(b.role);
    if (byRole !== 0) return byRole;
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
    return a.contact_detail.full_name.localeCompare(b.contact_detail.full_name);
  });
}

function writeLinkToCache(
  queryClient: ReturnType<typeof useQueryClient>,
  dealId: string,
  incoming: DealContact,
) {
  queryClient.setQueryData<DealContact[]>(dealContactsQueryKey(dealId), (existing) =>
    ordered([...(existing ?? []).filter((link) => link.id !== incoming.id), incoming]),
  );
  invalidateDealContactData(queryClient, dealId);
}

export async function listDealContacts(dealId: string): Promise<DealContact[]> {
  const links = await fetchAllPages<DealContact>(
    `api/deal-contacts/?deal=${encodeURIComponent(dealId)}`,
  );
  return ordered(links);
}

export function createContact(payload: CreateContactPayload): Promise<Contact> {
  return apiRequest<Contact>('api/contacts/', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function createDealContact(payload: CreateDealContactPayload): Promise<DealContact> {
  return apiRequest<DealContact>('api/deal-contacts/', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function updateContact(id: string, payload: Partial<CreateContactPayload>): Promise<Contact> {
  return apiRequest<Contact>(`api/contacts/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function updateDealContact(
  id: string,
  payload: Partial<Pick<CreateDealContactPayload, 'is_primary' | 'notes'>>,
): Promise<DealContact> {
  return apiRequest<DealContact>(`api/deal-contacts/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export function deleteDealContact(id: string): Promise<void> {
  return apiRequest<void>(`api/deal-contacts/${id}/`, { method: 'DELETE' });
}

/**
 * Raised when the person was saved but the second request could not attach it
 * to the deal. The panel can then retry only the link instead of duplicating a
 * contact or asking the analyst to re-enter the person.
 */
export class ContactCreatedButUnlinkedError extends Error {
  contact: Contact;
  linkError: unknown;

  constructor(contact: Contact, linkError: unknown) {
    super('The contact was created, but could not be linked to this deal.');
    this.name = 'ContactCreatedButUnlinkedError';
    this.contact = contact;
    this.linkError = linkError;
  }
}

export async function createAndLinkContact(
  dealId: string,
  payload: CreateAndLinkContactPayload,
): Promise<DealContact> {
  const contact = await createContact(payload.contact);
  try {
    return await createDealContact({
      deal: dealId,
      contact: contact.id,
      role: payload.role,
      is_primary: payload.is_primary,
      notes: payload.notes,
    });
  } catch (error) {
    throw new ContactCreatedButUnlinkedError(contact, error);
  }
}

export function useDealContacts(dealId: string | undefined) {
  return useQuery({
    queryKey: dealContactsQueryKey(dealId ?? ''),
    queryFn: () => listDealContacts(dealId ?? ''),
    enabled: Boolean(dealId),
  });
}

export function useCreateAndLinkContact(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateAndLinkContactPayload) => createAndLinkContact(dealId, payload),
    onSuccess: (link) => writeLinkToCache(queryClient, dealId, link),
  });
}

export function useCreateDealContactLink(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Omit<CreateDealContactPayload, 'deal'>) =>
      createDealContact({ deal: dealId, ...payload }),
    onSuccess: (link) => writeLinkToCache(queryClient, dealId, link),
  });
}

export function useUpdateContact(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ contactId, payload }: { contactId: string; payload: Partial<CreateContactPayload> }) =>
      updateContact(contactId, payload),
    onSuccess: () => invalidateDealContactData(queryClient, dealId),
  });
}

export function useUpdateDealContact(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ linkId, payload }: {
      linkId: string;
      payload: Partial<Pick<CreateDealContactPayload, 'is_primary' | 'notes'>>;
    }) => updateDealContact(linkId, payload),
    onSuccess: (link) => writeLinkToCache(queryClient, dealId, link),
  });
}

export function useDeleteDealContact(dealId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteDealContact,
    onSuccess: () => invalidateDealContactData(queryClient, dealId),
  });
}
