import { describe, expect, it } from 'vitest';

import type { ActivityLogEntry, Deal, Paginated, Sponsor } from '@/types/deal';
import { mockApiRequest } from './handlers';

describe('expanded intake mock API', () => {
  it('preserves the promoted deal, sponsor, and property fields through nested creation and edit', async () => {
    const created = await mockApiRequest<Deal>('api/deals/', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Demo Expanded Intake',
        investment_type: 'whole_loan_bridge',
        requested_amount: '7200000.00',
        purpose: 'Acquisition financing',
        profile: 'Light value-add industrial',
        estimated_value: '11000000.00',
        renovation_budget: '450000.00',
        description: 'Manual test deal with the promoted Release 1 intake fields.',
        source_channel: 'direct',
        source_date: '2026-07-10',
        sponsor: {
          entity_name: 'Demo Sponsor Holdings',
          entity_type: 'llc',
          primary_contact_name: 'Casey Demo',
          primary_contact_email: 'casey.demo@example.com',
          relationship_rating: 'developing',
          website: 'https://example.com',
          years_experience: 14,
          completed_projects: 22,
          bankruptcy_history: false,
        },
        properties: [{
          address: '101 Demo Avenue',
          city: 'Austin',
          state: 'tx',
          zip: '78701',
          property_type: 'industrial',
          subtype: 'last_mile',
          units: 3,
          rentable_square_feet: 87500,
          year_built: 1998,
          year_renovated: 2022,
          county: 'Travis',
          msa: 'Austin-Round Rock',
        }],
      }),
    });

    expect(created).toMatchObject({
      purpose: 'Acquisition financing',
      profile: 'Light value-add industrial',
      estimated_value: '11000000.00',
      renovation_budget: '450000.00',
      description: 'Manual test deal with the promoted Release 1 intake fields.',
      sponsor_detail: {
        website: 'https://example.com',
        years_experience: 14,
        completed_projects: 22,
        bankruptcy_history: false,
      },
    });
    expect(created.properties[0].property).toMatchObject({
      state: 'TX',
      subtype: 'last_mile',
      units: 3,
      rentable_square_feet: 87500,
      year_built: 1998,
      year_renovated: 2022,
      county: 'Travis',
    });

    const updated = await mockApiRequest<Deal>(`api/deals/${created.id}/`, {
      method: 'PATCH',
      body: JSON.stringify({
        purpose: 'Refinance',
        estimated_value: null,
        renovation_budget: '525000.00',
        description: 'Updated during manual underwriting review.',
      }),
    });
    expect(updated).toMatchObject({
      purpose: 'Refinance',
      estimated_value: null,
      renovation_budget: '525000.00',
      description: 'Updated during manual underwriting review.',
    });

    const activity = await mockApiRequest<Paginated<ActivityLogEntry>>(
      `api/activity-logs/?deal=${created.id}`,
    );
    const fieldUpdates = activity.results.filter((entry) => entry.action_type === 'field_updated');
    expect(new Set(fieldUpdates.map((entry) => entry.metadata.field))).toEqual(new Set([
      'purpose',
      'estimated_value',
      'renovation_budget',
      'description',
    ]));
    expect(fieldUpdates.every((entry) => entry.metadata.subject_id === created.id)).toBe(true);
  });

  it('rejects a renovation year earlier than the construction year', async () => {
    const sponsorsBefore = await mockApiRequest<Paginated<Sponsor>>('api/sponsors/');
    await expect(
      mockApiRequest('api/deals/', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Invalid Property Years',
          investment_type: 'whole_loan_bridge',
          requested_amount: '1000000.00',
          source_channel: 'direct',
          source_date: '2026-07-10',
          sponsor: {
            entity_name: 'Rolled Back Sponsor',
            entity_type: 'llc',
            primary_contact_name: 'Rollback Test',
            primary_contact_email: 'rollback@example.com',
            relationship_rating: 'new',
          },
          properties: [{
            address: '202 Invalid Year Road',
            city: 'Dallas',
            state: 'TX',
            zip: '75201',
            property_type: 'industrial',
            year_built: 2010,
            year_renovated: 2005,
          }],
        }),
      }),
    ).rejects.toMatchObject({
      status: 400,
      data: { year_renovated: ['Year renovated cannot be earlier than year built.'] },
    });
    const sponsorsAfter = await mockApiRequest<Paginated<Sponsor>>('api/sponsors/');
    expect(sponsorsAfter.count).toBe(sponsorsBefore.count);
  });

  it('rolls back earlier field mutations when a later update value is invalid', async () => {
    const created = await mockApiRequest<Deal>('api/deals/', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Atomic Demo Edit',
        investment_type: 'whole_loan_bridge',
        requested_amount: '1000000',
        purpose: 'Original purpose',
        source_channel: 'direct',
        source_date: '2026-07-10',
      }),
    });

    await expect(
      mockApiRequest(`api/deals/${created.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ purpose: 'Must not persist', fund: 'missing-fund' }),
      }),
    ).rejects.toMatchObject({ status: 400 });

    const after = await mockApiRequest<Deal>(`api/deals/${created.id}/`);
    expect(after.purpose).toBe('Original purpose');
    expect(after.fund).toBeNull();
    const activity = await mockApiRequest<Paginated<ActivityLogEntry>>(
      `api/activity-logs/?deal=${created.id}`,
    );
    expect(activity.results.filter((entry) => entry.action_type === 'field_updated')).toHaveLength(0);
  });

  it('rejects null text and invalid promoted money values like the live serializer', async () => {
    await expect(
      mockApiRequest('api/deals/', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Invalid Promoted Money',
          investment_type: 'whole_loan_bridge',
          requested_amount: '1000000.00',
          estimated_value: '-1.00',
          source_channel: 'direct',
          source_date: '2026-07-10',
        }),
      }),
    ).rejects.toMatchObject({ status: 400 });

    const created = await mockApiRequest<Deal>('api/deals/', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Null Text Validation',
        investment_type: 'whole_loan_bridge',
        requested_amount: '1000000.00',
        source_channel: 'direct',
        source_date: '2026-07-10',
      }),
    });
    await expect(
      mockApiRequest(`api/deals/${created.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ purpose: null }),
      }),
    ).rejects.toMatchObject({ status: 400, data: { purpose: ['Not a valid string.'] } });
  });

  it('rejects overlength promoted Deal and nested Sponsor strings', async () => {
    const base = {
      name: 'Oversized Inline Fields',
      investment_type: 'whole_loan_bridge',
      requested_amount: '1000000.00',
      source_channel: 'direct',
      source_date: '2026-07-10',
    };
    for (const field of ['purpose', 'profile'] as const) {
      await expect(
        mockApiRequest('api/deals/', {
          method: 'POST',
          body: JSON.stringify({ ...base, [field]: 'x'.repeat(161) }),
        }),
      ).rejects.toMatchObject({
        status: 400,
        data: { [field]: ['Ensure this field has no more than 160 characters.'] },
      });
    }

    await expect(
      mockApiRequest('api/deals/', {
        method: 'POST',
        body: JSON.stringify({
          ...base,
          sponsor: {
            entity_name: 'Oversized Sponsor LLC',
            entity_type: 'llc',
            primary_contact_name: 'Long Website',
            primary_contact_email: 'long.website@example.com',
            relationship_rating: 'new',
            website: `https://${'a'.repeat(193)}`,
          },
        }),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects promoted nested integer overflow and Property text overflow', async () => {
    const base = {
      name: 'Oversized Nested Facts',
      investment_type: 'whole_loan_bridge',
      requested_amount: '1000000.00',
      source_channel: 'direct',
      source_date: '2026-07-10',
    };
    await expect(
      mockApiRequest('api/deals/', {
        method: 'POST',
        body: JSON.stringify({
          ...base,
          sponsor: {
            entity_name: 'Oversized Projects LLC',
            entity_type: 'llc',
            primary_contact_name: 'Project Overflow',
            primary_contact_email: 'project.overflow@example.com',
            relationship_rating: 'new',
            completed_projects: 2_147_483_648,
          },
        }),
      }),
    ).rejects.toMatchObject({ status: 400 });

    const propertyBase = {
      address: '303 Bounds Road',
      city: 'Austin',
      state: 'TX',
      zip: '78703',
      property_type: 'multifamily',
    };
    const invalidPropertyFacts = [
      { subtype: 'x'.repeat(121) },
      { county: 'x'.repeat(121) },
      { msa: 'x'.repeat(161) },
      { units: 2_147_483_648 },
      { rentable_square_feet: '9223372036854775808' },
    ];
    for (const facts of invalidPropertyFacts) {
      await expect(
        mockApiRequest('api/deals/', {
          method: 'POST',
          body: JSON.stringify({ ...base, properties: [{ ...propertyBase, ...facts }] }),
        }),
      ).rejects.toMatchObject({ status: 400 });
    }
  });
});
