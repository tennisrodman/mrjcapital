import { describe, expect, it } from 'vitest';

import { createDealSchema, defaultCreateDealValues, type CreateDealForm } from './schema';

function validValues(): CreateDealForm {
  return {
    ...structuredClone(defaultCreateDealValues),
    name: 'Test Deal',
    investment_type: 'whole_loan_bridge',
    requested_amount: '1000000',
    source_channel: 'direct',
  };
}

describe('createDealSchema', () => {
  it('accepts zero and treats whitespace-only optional money as blank', () => {
    const result = createDealSchema.safeParse({
      ...validValues(),
      estimated_value: '0',
      renovation_budget: '   ',
    });

    expect(result.success).toBe(true);
  });

  it('rejects currency values with more than two decimal places', () => {
    const result = createDealSchema.safeParse({
      ...validValues(),
      requested_amount: '1000000.001',
      estimated_value: '2000000.999',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['requested_amount'] }),
      expect.objectContaining({ path: ['estimated_value'] }),
    ]));
  });

  it('ignores stale new-entity fields when existing records are selected', () => {
    const values = validValues();
    values.sponsor_mode = 'existing';
    values.sponsor_id = 'sponsor-1';
    values.sponsor_new.website = 'not a URL';
    values.sponsor_new.years_experience = '201';
    values.properties = [{
      mode: 'existing',
      property_id: 'property-1',
      units: '-1',
      year_built: 'not a year',
      year_renovated: '1600',
    }];

    expect(createDealSchema.safeParse(values).success).toBe(true);
  });

  it('requires the contact name needed by a new broker record', () => {
    const values = validValues();
    values.broker_mode = 'new';
    values.broker_new = {
      company_name: 'Broker Co',
      contact_name: '   ',
      email: 'broker@example.com',
      phone: '',
    };

    const result = createDealSchema.safeParse(values);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toContainEqual(expect.objectContaining({
      path: ['broker_new', 'contact_name'],
      message: 'Contact name is required',
    }));
  });

  it('matches backend sponsor URL and experience limits', () => {
    const values = validValues();
    values.sponsor_mode = 'new';
    values.sponsor_new = {
      entity_name: 'Sponsor LLC',
      entity_type: 'llc',
      primary_contact_name: 'Sponsor Contact',
      primary_contact_email: 'sponsor@example.com',
      primary_contact_phone: '',
      relationship_rating: 'new',
      website: 'https://',
      years_experience: '201',
      completed_projects: '',
      bankruptcy_history: '',
    };

    const result = createDealSchema.safeParse(values);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['sponsor_new', 'website'] }),
      expect.objectContaining({ path: ['sponsor_new', 'years_experience'] }),
    ]));
  });

  it('rejects single-label sponsor hosts except Django-supported localhost', () => {
    const values = validValues();
    values.sponsor_mode = 'new';
    values.sponsor_new = {
      entity_name: 'Sponsor LLC',
      entity_type: 'llc',
      primary_contact_name: 'Sponsor Contact',
      primary_contact_email: 'sponsor@example.com',
      primary_contact_phone: '',
      relationship_rating: 'new',
      website: 'https://intranet',
      years_experience: '',
      completed_projects: '',
      bankruptcy_history: '',
    };

    expect(createDealSchema.safeParse(values).success).toBe(false);
    values.sponsor_new.website = 'http://localhost';
    expect(createDealSchema.safeParse(values).success).toBe(true);
  });
});
