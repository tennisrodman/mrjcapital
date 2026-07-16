import { describe, expect, it } from 'vitest';

import type { ActivityLogEntry, Deal, Paginated, Property, Sponsor } from '@/types/deal';
import { mockApiRequest } from './handlers';

describe('promoted sponsor and property facts mock API', () => {
  it('patches promoted facts and exposes them through the deal nested details', async () => {
    const sponsor = await mockApiRequest<Sponsor>('api/sponsors/sp-larkspur/', {
      method: 'PATCH',
      body: JSON.stringify({
        website: 'https://capital.example.com',
        years_experience: 19,
        completed_projects: 31,
        bankruptcy_history: false,
      }),
    });
    expect(sponsor).toMatchObject({
      website: 'https://capital.example.com',
      years_experience: 19,
      completed_projects: 31,
      bankruptcy_history: false,
    });

    const property = await mockApiRequest<Property>('api/properties/pr-larkspur/', {
      method: 'PATCH',
      body: JSON.stringify({
        subtype: 'renovated_garden',
        units: 186,
        rentable_square_feet: 158000,
        year_built: 1988,
        year_renovated: 2024,
        county: 'Travis County',
      }),
    });
    expect(property).toMatchObject({
      subtype: 'renovated_garden',
      units: 186,
      rentable_square_feet: 158000,
      year_built: 1988,
      year_renovated: 2024,
      county: 'Travis County',
    });

    const deal = await mockApiRequest<Deal>('api/deals/deal-larkspur/');
    expect(deal.sponsor_detail).toMatchObject(sponsor);
    expect(deal.properties[0].property).toMatchObject(property);

    const dealActivity = await mockApiRequest<Paginated<ActivityLogEntry>>(
      'api/activity-logs/?deal=deal-larkspur',
    );
    expect(dealActivity.results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action_type: 'field_updated',
        description: 'Sponsor website updated',
        old_value: 'https://larkspurcap.com',
        new_value: 'https://capital.example.com',
        metadata: {
          field: 'website',
          subject_model: 'Sponsor',
          subject_id: 'sp-larkspur',
        },
      }),
      expect.objectContaining({
        action_type: 'field_updated',
        description: 'Property units updated',
        old_value: '184',
        new_value: '186',
        metadata: {
          field: 'units',
          subject_model: 'Property',
          subject_id: 'pr-larkspur',
        },
      }),
    ]));
    const otherLinkedDealActivity = await mockApiRequest<Paginated<ActivityLogEntry>>(
      'api/activity-logs/?deal=deal-maple',
    );
    expect(otherLinkedDealActivity.results).toEqual(expect.arrayContaining([
      expect.objectContaining({
        description: 'Sponsor website updated',
        metadata: expect.objectContaining({ subject_id: 'sp-larkspur' }),
      }),
    ]));
  });

  it('does not leak partial sponsor or property values after validation errors', async () => {
    const sponsorBefore = await mockApiRequest<Sponsor>('api/sponsors/sp-larkspur/');
    await expect(
      mockApiRequest('api/sponsors/sp-larkspur/', {
        method: 'PATCH',
        body: JSON.stringify({ website: 'https://must-not-persist.example', years_experience: 201 }),
      }),
    ).rejects.toMatchObject({ status: 400 });
    const sponsorAfter = await mockApiRequest<Sponsor>('api/sponsors/sp-larkspur/');
    expect(sponsorAfter).toEqual(sponsorBefore);

    const propertyBefore = await mockApiRequest<Property>('api/properties/pr-larkspur/');
    await expect(
      mockApiRequest('api/properties/pr-larkspur/', {
        method: 'PATCH',
        body: JSON.stringify({ subtype: 'must_not_persist', year_built: 2020, year_renovated: 2019 }),
      }),
    ).rejects.toMatchObject({
      status: 400,
      data: { year_renovated: ['Year renovated cannot be earlier than year built.'] },
    });
    const propertyAfter = await mockApiRequest<Property>('api/properties/pr-larkspur/');
    expect(propertyAfter).toEqual(propertyBefore);
  });

  it('preserves shared Sponsor and Property references after a failed Deal patch', async () => {
    const dealBefore = await mockApiRequest<Deal>('api/deals/deal-larkspur/');
    await expect(
      mockApiRequest('api/deals/deal-larkspur/', {
        method: 'PATCH',
        body: JSON.stringify({
          purpose: 'refinance',
          fund: 'missing-fund',
        }),
      }),
    ).rejects.toMatchObject({ status: 400 });

    await mockApiRequest<Sponsor>('api/sponsors/sp-larkspur/', {
      method: 'PATCH',
      body: JSON.stringify({ years_experience: 20 }),
    });
    await mockApiRequest<Property>('api/properties/pr-larkspur/', {
      method: 'PATCH',
      body: JSON.stringify({ units: 190 }),
    });

    const dealAfter = await mockApiRequest<Deal>('api/deals/deal-larkspur/');
    expect(dealAfter.purpose).toBe(dealBefore.purpose);
    expect(dealAfter.sponsor_detail?.years_experience).toBe(20);
    expect(dealAfter.properties[0].property.units).toBe(190);
  });

  it('supports full PUT updates and nullable fact clearing like Live', async () => {
    const sponsor = await mockApiRequest<Sponsor>('api/sponsors/', {
      method: 'POST',
      body: JSON.stringify({
        entity_name: 'PUT Sponsor LLC',
        entity_type: 'llc',
        primary_contact_name: 'Pat Update',
        primary_contact_email: 'pat.update@example.com',
        relationship_rating: 'new',
      }),
    });
    const replacedSponsor = await mockApiRequest<Sponsor>(`api/sponsors/${sponsor.id}/`, {
      method: 'PUT',
      body: JSON.stringify({
        entity_name: 'PUT Sponsor Holdings',
        entity_type: 'lp',
        primary_contact_name: 'Pat Update',
        primary_contact_email: 'pat.update@example.com',
        relationship_rating: 'established',
        website: 'https://put-sponsor.example.com',
        years_experience: 10,
        completed_projects: 12,
        bankruptcy_history: true,
      }),
    });
    expect(replacedSponsor).toMatchObject({
      entity_name: 'PUT Sponsor Holdings',
      entity_type: 'lp',
      years_experience: 10,
      bankruptcy_history: true,
    });
    const clearedSponsor = await mockApiRequest<Sponsor>(`api/sponsors/${sponsor.id}/`, {
      method: 'PATCH',
      body: JSON.stringify({ years_experience: null, completed_projects: null, bankruptcy_history: null }),
    });
    expect(clearedSponsor).toMatchObject({
      years_experience: null,
      completed_projects: null,
      bankruptcy_history: null,
    });

    const property = await mockApiRequest<Property>('api/properties/', {
      method: 'POST',
      body: JSON.stringify({
        address: '700 PUT Lane',
        city: 'Austin',
        state: 'TX',
        zip: '78702',
        property_type: 'multifamily',
      }),
    });
    const replacedProperty = await mockApiRequest<Property>(`api/properties/${property.id}/`, {
      method: 'PUT',
      body: JSON.stringify({
        address: '701 PUT Lane',
        city: 'Austin',
        state: 'tx',
        zip: '78702',
        property_type: 'multifamily',
        subtype: 'midrise',
        units: 72,
        rentable_square_feet: 66000,
        year_built: 2001,
        year_renovated: 2020,
        county: 'Travis',
      }),
    });
    expect(replacedProperty).toMatchObject({
      address: '701 PUT Lane',
      state: 'TX',
      subtype: 'midrise',
      units: 72,
      year_renovated: 2020,
    });
    const clearedProperty = await mockApiRequest<Property>(`api/properties/${property.id}/`, {
      method: 'PATCH',
      body: JSON.stringify({
        units: null,
        rentable_square_feet: null,
        year_built: null,
        year_renovated: null,
      }),
    });
    expect(clearedProperty).toMatchObject({
      units: null,
      rentable_square_feet: null,
      year_built: null,
      year_renovated: null,
    });
  });

  it('returns 404 for missing detail ids and requires base fields on PUT', async () => {
    await expect(mockApiRequest('api/sponsors/missing-sponsor/')).rejects.toMatchObject({ status: 404 });
    await expect(mockApiRequest('api/properties/missing-property/')).rejects.toMatchObject({ status: 404 });
    await expect(
      mockApiRequest('api/sponsors/sp-larkspur/', {
        method: 'PUT',
        body: JSON.stringify({ website: 'https://partial-put.example.com' }),
      }),
    ).rejects.toMatchObject({ status: 400, data: { entity_name: ['This field is required.'] } });
    await expect(
      mockApiRequest('api/properties/pr-larkspur/', {
        method: 'PUT',
        body: JSON.stringify({ subtype: 'partial_put' }),
      }),
    ).rejects.toMatchObject({ status: 400, data: { address: ['This field is required.'] } });
  });

  it('accepts localhost websites but rejects single-label intranet hosts without mutation', async () => {
    const sponsor = await mockApiRequest<Sponsor>('api/sponsors/', {
      method: 'POST',
      body: JSON.stringify({
        entity_name: 'Local Sponsor LLC',
        entity_type: 'llc',
        primary_contact_name: 'Local Host',
        primary_contact_email: 'localhost@example.com',
        relationship_rating: 'new',
        website: 'https://localhost',
      }),
    });
    expect(sponsor.website).toBe('https://localhost');

    await expect(
      mockApiRequest(`api/sponsors/${sponsor.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({ website: 'https://intranet' }),
      }),
    ).rejects.toMatchObject({ status: 400 });
    const after = await mockApiRequest<Sponsor>(`api/sponsors/${sponsor.id}/`);
    expect(after.website).toBe('https://localhost');
  });

  it('deletes unattached records and rejects linked Sponsor and Property deletion', async () => {
    const unattachedSponsor = await mockApiRequest<Sponsor>('api/sponsors/', {
      method: 'POST',
      body: JSON.stringify({
        entity_name: 'Disposable Sponsor LLC',
        entity_type: 'llc',
        primary_contact_name: 'Delete Me',
        primary_contact_email: 'delete.sponsor@example.com',
        relationship_rating: 'new',
      }),
    });
    const unattachedProperty = await mockApiRequest<Property>('api/properties/', {
      method: 'POST',
      body: JSON.stringify({
        address: '999 Disposable Way',
        city: 'Austin',
        state: 'TX',
        zip: '78799',
        property_type: 'other',
      }),
    });

    expect(await mockApiRequest(`api/sponsors/${unattachedSponsor.id}/`, { method: 'DELETE' })).toEqual({});
    expect(await mockApiRequest(`api/properties/${unattachedProperty.id}/`, { method: 'DELETE' })).toEqual({});
    await expect(mockApiRequest(`api/sponsors/${unattachedSponsor.id}/`)).rejects.toMatchObject({ status: 404 });
    await expect(mockApiRequest(`api/properties/${unattachedProperty.id}/`)).rejects.toMatchObject({ status: 404 });

    await expect(
      mockApiRequest('api/sponsors/sp-larkspur/', { method: 'DELETE' }),
    ).rejects.toMatchObject({
      status: 400,
      data: { detail: 'This sponsor is linked to one or more deals and cannot be deleted.' },
    });
    await expect(
      mockApiRequest('api/properties/pr-larkspur/', { method: 'DELETE' }),
    ).rejects.toMatchObject({
      status: 400,
      data: { detail: 'This property is linked to one or more deals and cannot be deleted.' },
    });
    const linkedDeal = await mockApiRequest<Deal>('api/deals/deal-larkspur/');
    expect(linkedDeal.sponsor).toBe('sp-larkspur');
    expect(linkedDeal.properties.some((link) => link.property.id === 'pr-larkspur')).toBe(true);
  });
});
