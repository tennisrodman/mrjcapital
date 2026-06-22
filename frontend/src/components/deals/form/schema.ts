import { z } from 'zod';

const entitySub = z.object({
  entity_name: z.string().optional(),
  entity_type: z.string().optional(),
  primary_contact_name: z.string().optional(),
  primary_contact_email: z.string().optional(),
  primary_contact_phone: z.string().optional(),
  relationship_rating: z.string().optional(),
});

const brokerSub = z.object({
  company_name: z.string().optional(),
  contact_name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
});

const propertyRow = z.object({
  mode: z.enum(['existing', 'new']),
  property_id: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  property_type: z.string().optional(),
  msa: z.string().optional(),
});

function requireEmail(value: string | undefined): boolean {
  return Boolean(value && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

export const createDealSchema = z
  .object({
    name: z.string().trim().min(1, 'Deal name is required'),
    investment_type: z.string().min(1, 'Select an investment type'),
    requested_amount: z
      .string()
      .min(1, 'Enter the requested amount')
      .refine((value) => Number(value) > 0, 'Enter an amount greater than zero'),
    source_channel: z.string().min(1, 'Select a source channel'),
    source_date: z.string().min(1, 'Select a source date'),
    fund_id: z.string().optional(),

    sponsor_mode: z.enum(['existing', 'new']),
    sponsor_id: z.string().optional(),
    sponsor_new: entitySub,

    broker_mode: z.enum(['none', 'existing', 'new']),
    broker_id: z.string().optional(),
    broker_new: brokerSub,

    properties: z.array(propertyRow).min(1, 'Add at least one property'),
  })
  .superRefine((value, ctx) => {
    if (value.sponsor_mode === 'existing' && !value.sponsor_id) {
      ctx.addIssue({ code: 'custom', path: ['sponsor_id'], message: 'Choose a sponsor' });
    }
    if (value.sponsor_mode === 'new') {
      if (!value.sponsor_new.entity_name?.trim()) {
        ctx.addIssue({ code: 'custom', path: ['sponsor_new', 'entity_name'], message: 'Entity name is required' });
      }
      if (!value.sponsor_new.primary_contact_name?.trim()) {
        ctx.addIssue({ code: 'custom', path: ['sponsor_new', 'primary_contact_name'], message: 'Contact name is required' });
      }
      if (!requireEmail(value.sponsor_new.primary_contact_email)) {
        ctx.addIssue({ code: 'custom', path: ['sponsor_new', 'primary_contact_email'], message: 'Enter a valid email' });
      }
    }

    if (value.broker_mode === 'existing' && !value.broker_id) {
      ctx.addIssue({ code: 'custom', path: ['broker_id'], message: 'Choose a broker' });
    }
    if (value.broker_mode === 'new') {
      if (!value.broker_new.company_name?.trim()) {
        ctx.addIssue({ code: 'custom', path: ['broker_new', 'company_name'], message: 'Company name is required' });
      }
      if (!requireEmail(value.broker_new.email)) {
        ctx.addIssue({ code: 'custom', path: ['broker_new', 'email'], message: 'Enter a valid email' });
      }
    }

    value.properties.forEach((row, index) => {
      if (row.mode === 'existing' && !row.property_id) {
        ctx.addIssue({ code: 'custom', path: ['properties', index, 'property_id'], message: 'Choose a property' });
      }
      if (row.mode === 'new') {
        for (const field of ['address', 'city', 'state', 'zip', 'property_type'] as const) {
          if (!row[field]?.trim()) {
            ctx.addIssue({ code: 'custom', path: ['properties', index, field], message: 'Required' });
          }
        }
      }
    });
  });

export type CreateDealForm = z.infer<typeof createDealSchema>;

export const defaultCreateDealValues: CreateDealForm = {
  name: '',
  investment_type: '',
  requested_amount: '',
  source_channel: '',
  source_date: new Date().toISOString().slice(0, 10),
  fund_id: '',
  sponsor_mode: 'existing',
  sponsor_id: '',
  sponsor_new: {
    entity_name: '',
    entity_type: 'llc',
    primary_contact_name: '',
    primary_contact_email: '',
    primary_contact_phone: '',
    relationship_rating: 'new',
  },
  broker_mode: 'none',
  broker_id: '',
  broker_new: { company_name: '', contact_name: '', email: '', phone: '' },
  properties: [
    { mode: 'existing', property_id: '', address: '', city: '', state: '', zip: '', property_type: '', msa: '' },
  ],
};
