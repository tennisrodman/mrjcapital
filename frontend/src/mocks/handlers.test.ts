import { describe, expect, it } from 'vitest';

import type { Deal } from '@/types/deal';
import { PROPERTIES } from './fixtures';
import { mockApiRequest } from './handlers';

const basePayload = {
  name: 'Mock parity test deal',
  investment_type: 'lp_equity',
  requested_amount: '1250000',
  source_channel: 'direct',
  source_date: '2026-06-24',
  properties: [PROPERTIES[0].id],
} satisfies Record<string, unknown>;

describe('mock deal handlers', () => {
  it('rejects empty sponsor payloads like the backend serializer', async () => {
    await expect(
      mockApiRequest('api/deals/', {
        method: 'POST',
        body: JSON.stringify({ ...basePayload, sponsor: {} }),
      }),
    ).rejects.toMatchObject({
      status: 400,
      data: {
        sponsor: ['Provide an id or fields to create this relationship.'],
      },
    });
  });

  it('treats empty broker payloads as null like the backend serializer', async () => {
    const deal = await mockApiRequest<Deal>('api/deals/', {
      method: 'POST',
      body: JSON.stringify({
        ...basePayload,
        name: 'Mock empty broker parity test deal',
        sponsor: {
          entity_name: 'Mock Test Sponsor',
          entity_type: 'llc',
          primary_contact_name: 'Case Reviewer',
          primary_contact_email: 'reviewer@example.com',
          primary_contact_phone: '',
          relationship_rating: 'new',
        },
        broker: {},
      }),
    });

    expect(deal.broker).toBeNull();
    expect(deal.broker_detail).toBeNull();
  });
});
