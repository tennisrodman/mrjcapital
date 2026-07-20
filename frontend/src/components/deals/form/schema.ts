import { z } from 'zod';
import {
  isOptionalHttpUrl,
  isOptionalWholeNumber,
  isOptionalYear,
} from '@/lib/formValidation';
import { SUPPORTED_DEBT_INVESTMENT_TYPES } from './options';

const entitySub = z.object({
  entity_name: z.string().optional(),
  entity_type: z.string().optional(),
  primary_contact_name: z.string().optional(),
  primary_contact_email: z.string().optional(),
  primary_contact_phone: z.string().optional(),
  relationship_rating: z.string().optional(),
  website: z.string().optional(),
  years_experience: z.string().optional(),
  completed_projects: z.string().optional(),
  bankruptcy_history: z.string().optional(),
  business_address: z.string().optional(),
  total_units_owned: z.string().optional(),
  total_sf_managed: z.string().optional(),
  assets_under_management: z.string().optional(),
  connection_source: z.string().optional(),
});

const brokerSub = z.object({
  company_name: z.string().optional(),
  contact_name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  default_commission_rate: z.string().optional(),
  commission_type: z.string().optional(),
  preferred_deal_types: z.string().optional(),
  geographic_focus: z.string().optional(),
});

const propertyRow = z.object({
  mode: z.enum(['existing', 'new']),
  property_id: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  property_type: z.string().optional(),
  subtype: z.string().optional(),
  units: z.string().optional(),
  rentable_square_feet: z.string().optional(),
  year_built: z.string().optional(),
  year_renovated: z.string().optional(),
  county: z.string().optional(),
  msa: z.string().optional(),
  number_of_buildings: z.string().optional(),
  number_of_stories: z.string().optional(),
  parking_spaces: z.string().optional(),
  lot_size_acres: z.string().optional(),
  flood_zone: z.string().optional(),
  zoning_designation: z.string().optional(),
  environmental_status: z.string().optional(),
});

export function isOptionalCurrency(value: string | undefined): boolean {
  const normalized = value?.trim();
  if (!normalized) return true;
  return /^\d+(?:\.\d{1,2})?$/.test(normalized);
}

function isPositiveCurrency(value: string): boolean {
  return isOptionalCurrency(value) && Number(value) > 0;
}

function isOptionalNonnegativeDecimal(value: string | undefined): boolean {
  const normalized = value?.trim();
  return !normalized || /^\d+(?:\.\d{1,4})?$/.test(normalized);
}

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
      .refine(isPositiveCurrency, 'Enter a positive amount with no more than 2 decimal places'),
    purpose: z.string().optional(),
    profile: z.string().optional(),
    estimated_value: z
      .string()
      .optional()
      .refine(isOptionalCurrency, 'Enter zero or a positive amount with no more than 2 decimal places'),
    renovation_budget: z
      .string()
      .optional()
      .refine(isOptionalCurrency, 'Enter zero or a positive amount with no more than 2 decimal places'),
    description: z.string().optional(),
    source_channel: z.string().min(1, 'Select a source channel'),
    source_date: z.string().min(1, 'Select a source date'),
    fund_id: z.string().optional(),

    sponsor_mode: z.enum(['none', 'existing', 'new']),
    sponsor_id: z.string().optional(),
    sponsor_new: entitySub,

    broker_mode: z.enum(['none', 'existing', 'new']),
    broker_id: z.string().optional(),
    broker_new: brokerSub,

    properties: z.array(propertyRow),
  })
  .superRefine((value, ctx) => {
    if (value.investment_type && !SUPPORTED_DEBT_INVESTMENT_TYPES.has(value.investment_type)) {
      ctx.addIssue({
        code: 'custom',
        path: ['investment_type'],
        message: 'Only debt investments are available in the current release',
      });
    }
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
      if (!isOptionalHttpUrl(value.sponsor_new.website)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sponsor_new', 'website'],
          message: 'Enter a URL beginning with http:// or https://',
        });
      }
      if (!isOptionalWholeNumber(value.sponsor_new.years_experience, 200)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sponsor_new', 'years_experience'],
          message: 'Enter a whole number from 0 to 200',
        });
      }
      if (!isOptionalWholeNumber(value.sponsor_new.completed_projects)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sponsor_new', 'completed_projects'],
          message: 'Enter a whole number',
        });
      }
      for (const field of ['total_units_owned', 'total_sf_managed'] as const) {
        if (!isOptionalWholeNumber(value.sponsor_new[field])) {
          ctx.addIssue({
            code: 'custom',
            path: ['sponsor_new', field],
            message: 'Enter zero or a positive whole number',
          });
        }
      }
      if (!isOptionalCurrency(value.sponsor_new.assets_under_management)) {
        ctx.addIssue({
          code: 'custom',
          path: ['sponsor_new', 'assets_under_management'],
          message: 'Enter a nonnegative amount with no more than 2 decimal places',
        });
      }
      if (!['', 'yes', 'no'].includes(value.sponsor_new.bankruptcy_history ?? '')) {
        ctx.addIssue({
          code: 'custom',
          path: ['sponsor_new', 'bankruptcy_history'],
          message: 'Select Unknown, Yes, or No',
        });
      }
    }

    if (value.broker_mode === 'existing' && !value.broker_id) {
      ctx.addIssue({ code: 'custom', path: ['broker_id'], message: 'Choose a broker' });
    }
    if (value.broker_mode === 'new') {
      if (!value.broker_new.company_name?.trim()) {
        ctx.addIssue({ code: 'custom', path: ['broker_new', 'company_name'], message: 'Company name is required' });
      }
      if (!value.broker_new.contact_name?.trim()) {
        ctx.addIssue({ code: 'custom', path: ['broker_new', 'contact_name'], message: 'Contact name is required' });
      }
      if (!requireEmail(value.broker_new.email)) {
        ctx.addIssue({ code: 'custom', path: ['broker_new', 'email'], message: 'Enter a valid email' });
      }
      if (!isOptionalNonnegativeDecimal(value.broker_new.default_commission_rate)) {
        ctx.addIssue({
          code: 'custom',
          path: ['broker_new', 'default_commission_rate'],
          message: 'Enter a nonnegative rate with no more than 4 decimal places',
        });
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
        if (!isOptionalWholeNumber(row.units)) {
          ctx.addIssue({ code: 'custom', path: ['properties', index, 'units'], message: 'Enter a whole number' });
        }
        if (!isOptionalWholeNumber(row.rentable_square_feet)) {
          ctx.addIssue({
            code: 'custom',
            path: ['properties', index, 'rentable_square_feet'],
            message: 'Enter a whole number',
          });
        }
        for (const field of ['number_of_buildings', 'number_of_stories', 'parking_spaces'] as const) {
          if (!isOptionalWholeNumber(row[field])) {
            ctx.addIssue({
              code: 'custom',
              path: ['properties', index, field],
              message: 'Enter zero or a positive whole number',
            });
          }
        }
        if (!isOptionalNonnegativeDecimal(row.lot_size_acres)) {
          ctx.addIssue({
            code: 'custom',
            path: ['properties', index, 'lot_size_acres'],
            message: 'Enter a nonnegative acreage with no more than 4 decimal places',
          });
        }
        if (
          ['multifamily', 'self_storage', 'hotel'].includes(row.property_type ?? '')
          && !row.units?.trim()
        ) {
          ctx.addIssue({
            code: 'custom',
            path: ['properties', index, 'units'],
            message: 'Units are required for this property type',
          });
        }
        if (!isOptionalYear(row.year_built)) {
          ctx.addIssue({
            code: 'custom',
            path: ['properties', index, 'year_built'],
            message: 'Enter a year from 1700 to 2200',
          });
        }
        if (!isOptionalYear(row.year_renovated)) {
          ctx.addIssue({
            code: 'custom',
            path: ['properties', index, 'year_renovated'],
            message: 'Enter a year from 1700 to 2200',
          });
        }
        if (
          row.year_built &&
          row.year_renovated &&
          Number(row.year_renovated) < Number(row.year_built)
        ) {
          ctx.addIssue({
            code: 'custom',
            path: ['properties', index, 'year_renovated'],
            message: 'Cannot be earlier than year built',
          });
        }
      }
    });
  });

export type CreateDealForm = z.infer<typeof createDealSchema>;

export const defaultCreateDealValues: CreateDealForm = {
  name: '',
  investment_type: '',
  requested_amount: '',
  purpose: '',
  profile: '',
  estimated_value: '',
  renovation_budget: '',
  description: '',
  source_channel: '',
  source_date: new Date().toISOString().slice(0, 10),
  fund_id: '',
  sponsor_mode: 'none',
  sponsor_id: '',
  sponsor_new: {
    entity_name: '',
    entity_type: 'llc',
    primary_contact_name: '',
    primary_contact_email: '',
    primary_contact_phone: '',
    relationship_rating: 'new',
    website: '',
    years_experience: '',
    completed_projects: '',
    bankruptcy_history: '',
    business_address: '',
    total_units_owned: '',
    total_sf_managed: '',
    assets_under_management: '',
    connection_source: '',
  },
  broker_mode: 'none',
  broker_id: '',
  broker_new: {
    company_name: '',
    contact_name: '',
    email: '',
    phone: '',
    default_commission_rate: '',
    commission_type: '',
    preferred_deal_types: '',
    geographic_focus: '',
  },
  properties: [],
};
