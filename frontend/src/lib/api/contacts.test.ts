import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('@/config/api', () => ({ apiRequest: api.request }));

import {
  ContactCreatedButUnlinkedError,
  createAndLinkContact,
  createContact,
  createDealContact,
  listDealContacts,
} from './contacts';
import type { Contact, CreateAndLinkContactPayload, DealContact } from '@/types/contact';

const contact: Contact = {
  id: 'contact-1',
  full_name: 'Avery Stone',
  title: 'Managing Director',
  company_name: 'Stone Capital',
  email: 'avery@stone.example',
  phone: '212-555-0100',
  details: {},
  created_at: '2026-07-01T12:00:00Z',
  updated_at: '2026-07-01T12:00:00Z',
};

const link: DealContact = {
  id: 'deal-contact-1',
  deal: 'deal-1',
  contact: contact.id,
  contact_detail: contact,
  role: 'sponsor_contact',
  is_primary: true,
  notes: 'First point of contact for borrower diligence.',
  created_at: '2026-07-01T12:00:00Z',
  updated_at: '2026-07-01T12:00:00Z',
};

const payload: CreateAndLinkContactPayload = {
  contact: {
    full_name: contact.full_name,
    title: contact.title,
    company_name: contact.company_name,
    email: contact.email,
    phone: contact.phone,
  },
  role: link.role,
  is_primary: link.is_primary,
  notes: link.notes,
};

describe('contact API contract', () => {
  beforeEach(() => api.request.mockReset());

  it('lists a deal-filtered, paginated contact-link collection', async () => {
    api.request.mockResolvedValue({ count: 1, next: null, previous: null, results: [link] });

    await expect(listDealContacts('deal / 1')).resolves.toEqual([link]);
    expect(api.request).toHaveBeenCalledWith('api/deal-contacts/?deal=deal%20%2F%201');
  });

  it('creates the person before creating its deal-contact link', async () => {
    api.request.mockResolvedValueOnce(contact).mockResolvedValueOnce(link);

    await expect(createAndLinkContact('deal-1', payload)).resolves.toEqual(link);
    expect(api.request).toHaveBeenNthCalledWith(1, 'api/contacts/', {
      method: 'POST',
      body: JSON.stringify(payload.contact),
    });
    expect(api.request).toHaveBeenNthCalledWith(2, 'api/deal-contacts/', {
      method: 'POST',
      body: JSON.stringify({
        deal: 'deal-1',
        contact: contact.id,
        role: payload.role,
        is_primary: payload.is_primary,
        notes: payload.notes,
      }),
    });
  });

  it('keeps individual create functions available for an unlinked-contact retry', async () => {
    api.request.mockResolvedValueOnce(contact).mockResolvedValueOnce(link);

    await expect(createContact(payload.contact)).resolves.toEqual(contact);
    await expect(
      createDealContact({
        deal: link.deal,
        contact: contact.id,
        role: link.role,
        is_primary: link.is_primary,
        notes: link.notes,
      }),
    ).resolves.toEqual(link);
  });

  it('preserves the created person when the link request fails', async () => {
    const linkFailure = new Error('primary role conflict');
    api.request.mockResolvedValueOnce(contact).mockRejectedValueOnce(linkFailure);

    let caught: unknown;
    try {
      await createAndLinkContact('deal-1', payload);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ContactCreatedButUnlinkedError);
    expect(caught).toMatchObject({ contact, linkError: linkFailure });
    expect(api.request).toHaveBeenCalledTimes(2);
  });
});
