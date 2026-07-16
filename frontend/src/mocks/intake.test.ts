import { beforeEach, describe, expect, it } from 'vitest';

import type { ActivityLogEntry, Deal, DealSummary, Paginated, Sponsor } from '@/types/deal';
import { setDemoIsStaffForTests } from '@/config/flags';
import { mockApiRequest } from './handlers';

describe('expanded intake mock API', () => {
  beforeEach(() => {
    setDemoIsStaffForTests(true);
  });

  it('enforces the same debt-only origination boundary as Live mode', async () => {
    const payload = {
      name: 'Debt-only boundary',
      requested_amount: '1000000.00',
      source_channel: 'direct',
      source_date: '2026-07-10',
    };
    await expect(
      mockApiRequest('api/deals/', {
        method: 'POST',
        body: JSON.stringify({ ...payload, investment_type: 'preferred_equity' }),
      }),
    ).rejects.toMatchObject({ status: 400 });

    const created = await mockApiRequest<Deal>('api/deals/', {
      method: 'POST',
      body: JSON.stringify({ ...payload, investment_type: 'whole_loan_permanent' }),
    });
    await expect(
      mockApiRequest(`api/deals/${created.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ investment_type: 'mezzanine' }),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('blocks non-staff from clearing existing relationships', async () => {
    setDemoIsStaffForTests(false);
    const sponsors = await mockApiRequest<Paginated<Sponsor>>('api/sponsors/');
    const created = await mockApiRequest<Deal>('api/deals/', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Analyst relationship lock',
        investment_type: 'whole_loan_bridge',
        requested_amount: '2500000.00',
        source_channel: 'direct',
        source_date: '2026-07-10',
        sponsor: sponsors.results[0].id,
      }),
    });
    await expect(
      mockApiRequest(`api/deals/${created.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ sponsor: null }),
      }),
    ).rejects.toMatchObject({
      status: 400,
      data: { sponsor: ['Only staff may change an existing relationship.'] },
    });
  });

  it('supports staff assignment and negotiation maintenance in Demo mode', async () => {
    const sponsors = await mockApiRequest<Paginated<Sponsor>>('api/sponsors/');
    const created = await mockApiRequest<Deal>('api/deals/', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Demo maintenance parity',
        investment_type: 'whole_loan_bridge',
        requested_amount: '2500000.00',
        source_channel: 'direct',
        source_date: '2026-07-10',
        sponsor: sponsors.results[0].id,
      }),
    });
    const assignees = await mockApiRequest<Array<{ id: number; username: string }>>('api/deals/assignees/');
    expect(assignees).toEqual([{ id: 1, username: expect.any(String) }]);

    const updated = await mockApiRequest<Deal>(`api/deals/${created.id}/`, {
      method: 'PATCH',
      body: JSON.stringify({
        assigned_analyst: null,
        sponsor: null,
        deposit_status: 'received',
        deposit_received_date: '2026-07-12',
        deposit_account_label: 'Operating escrow',
        deposit_refund_conditions: 'Refundable if title is not cleared.',
        exclusivity_granted: true,
        exclusivity_expiry_date: '2026-08-01',
        key_negotiation_changes: 'Reduced the holdback.',
      }),
    });
    expect(updated).toMatchObject({
      assigned_analyst: null,
      assigned_analyst_detail: null,
      sponsor: null,
      sponsor_detail: null,
      deposit_status: 'received',
      deposit_received_date: '2026-07-12',
      exclusivity_granted: true,
      key_negotiation_changes: 'Reduced the holdback.',
    });
  });

  it('excludes post-pipeline records from active Demo summary metrics', async () => {
    const allDeals = await mockApiRequest<Paginated<Deal>>('api/deals/?page_size=1000');
    const summary = await mockApiRequest<DealSummary>('api/deals/summary/');
    const inactive = new Set(['dead', 'closed', 'servicing', 'exited']);
    expect(summary.active_deals).toBe(
      allDeals.results.filter((deal) => !inactive.has(deal.pipeline_status)).length,
    );
  });

  it('preserves the promoted deal, sponsor, and property fields through nested creation and edit', async () => {
    const created = await mockApiRequest<Deal>('api/deals/', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Demo Expanded Intake',
        investment_type: 'whole_loan_bridge',
        requested_amount: '7200000.00',
        purpose: 'acquisition',
        profile: 'value_add',
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
      purpose: 'acquisition',
      profile: 'value_add',
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
        purpose: 'refinance',
        estimated_value: null,
        renovation_budget: '525000.00',
        description: 'Updated during manual underwriting review.',
      }),
    });
    expect(updated).toMatchObject({
      purpose: 'refinance',
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
        purpose: 'acquisition',
        source_channel: 'direct',
        source_date: '2026-07-10',
      }),
    });

    await expect(
      mockApiRequest(`api/deals/${created.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ purpose: 'refinance', fund: 'missing-fund' }),
      }),
    ).rejects.toMatchObject({ status: 400 });

    const after = await mockApiRequest<Deal>(`api/deals/${created.id}/`);
    expect(after.purpose).toBe('acquisition');
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
    ).rejects.toMatchObject({ status: 400, data: { purpose: expect.any(Array) } });
  });

  it('rejects unsupported controlled Deal choices and overlength nested Sponsor strings', async () => {
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
      ).rejects.toMatchObject({ status: 400 });
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
