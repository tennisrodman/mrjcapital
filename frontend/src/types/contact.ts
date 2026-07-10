/** Release 1 internal contact and deal-contact API contracts. */
export type DealContactRole =
  | 'source_contact'
  | 'sponsor_contact'
  | 'broker_contact'
  | 'borrower_counsel'
  | 'lender_counsel'
  | 'closing_contact';

export const DEAL_CONTACT_ROLE_LABELS: Record<DealContactRole, string> = {
  source_contact: 'Source contact',
  sponsor_contact: 'Sponsor contact',
  broker_contact: 'Broker contact',
  borrower_counsel: 'Borrower counsel',
  lender_counsel: 'Lender counsel',
  closing_contact: 'Closing contact',
};

export interface Contact {
  id: string;
  full_name: string;
  title: string;
  company_name: string;
  email: string;
  phone: string;
  details: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DealContact {
  id: string;
  deal: string;
  contact: string;
  contact_detail: Contact;
  role: DealContactRole;
  is_primary: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface CreateContactPayload {
  full_name: string;
  title: string;
  company_name: string;
  email: string;
  phone: string;
}

export interface CreateDealContactPayload {
  deal: string;
  contact: string;
  role: DealContactRole;
  is_primary: boolean;
  notes: string;
}

export interface CreateAndLinkContactPayload {
  contact: CreateContactPayload;
  role: DealContactRole;
  is_primary: boolean;
  notes: string;
}
