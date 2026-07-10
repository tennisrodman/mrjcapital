import { describe, expect, it } from 'vitest';

import type { Contact, DealContact } from '@/types/contact';
import type { Paginated } from '@/types/deal';
import { buildInitialDeals } from './fixtures';
import { mockApiRequest } from './handlers';

const dealId = buildInitialDeals()[0].id;

describe('contact mock API', () => {
  it('creates a reusable person, links it to a deal, and returns the nested contact', async () => {
    const personPayload = {
      full_name: 'Jordan Closing',
      title: 'Counsel',
      company_name: 'Closing LLP',
      email: 'JORDAN.CLOSING@EXAMPLE.COM',
      phone: '212-555-0110',
    };
    const contact = await mockApiRequest<Contact>('api/contacts/', {
      method: 'POST',
      body: JSON.stringify(personPayload),
    });
    expect(contact.email).toBe('jordan.closing@example.com');

    const link = await mockApiRequest<DealContact>('api/deal-contacts/', {
      method: 'POST',
      body: JSON.stringify({
        deal: dealId,
        contact: contact.id,
        role: 'closing_contact',
        is_primary: true,
        notes: 'Primary closing coordination.',
      }),
    });
    expect(link).toMatchObject({
      deal: dealId,
      contact: contact.id,
      role: 'closing_contact',
      is_primary: true,
      contact_detail: { full_name: 'Jordan Closing' },
    });

    const listed = await mockApiRequest<Paginated<DealContact>>(`api/deal-contacts/?deal=${dealId}`);
    expect(listed.results.some((row) => row.id === link.id)).toBe(true);
  });

  it('rejects a duplicate non-empty email case-insensitively', async () => {
    await expect(
      mockApiRequest('api/contacts/', {
        method: 'POST',
        body: JSON.stringify({ full_name: 'Duplicate', email: 'jordan.closing@example.com' }),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
