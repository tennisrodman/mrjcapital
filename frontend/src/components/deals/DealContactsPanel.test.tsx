import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const contactApi = vi.hoisted(() => ({
  useDealContacts: vi.fn(),
  useCreateAndLinkContact: vi.fn(),
  useCreateDealContactLink: vi.fn(),
}));

vi.mock('@/lib/api/contacts', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/contacts')>('@/lib/api/contacts');
  return {
    ...actual,
    useDealContacts: contactApi.useDealContacts,
    useCreateAndLinkContact: contactApi.useCreateAndLinkContact,
    useCreateDealContactLink: contactApi.useCreateDealContactLink,
  };
});

import { DealContactsPanel } from './DealContactsPanel';
import { ContactCreatedButUnlinkedError } from '@/lib/api/contacts';
import type { DealContact } from '@/types/contact';

const dealContact: DealContact = {
  id: 'link-1',
  deal: 'deal-1',
  contact: 'contact-1',
  contact_detail: {
    id: 'contact-1',
    full_name: 'Avery Stone',
    title: 'Managing Director',
    company_name: 'Stone Capital',
    email: 'avery@stone.example',
    phone: '212-555-0100',
    details: {},
    created_at: '2026-07-01T12:00:00Z',
    updated_at: '2026-07-01T12:00:00Z',
  },
  role: 'sponsor_contact',
  is_primary: true,
  notes: 'First point of contact for borrower diligence.',
  created_at: '2026-07-01T12:00:00Z',
  updated_at: '2026-07-01T12:00:00Z',
};

describe('DealContactsPanel', () => {
  beforeEach(() => {
    contactApi.useDealContacts.mockReturnValue({
      data: [dealContact],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    contactApi.useCreateAndLinkContact.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
    contactApi.useCreateDealContactLink.mockReturnValue({ isPending: false, mutateAsync: vi.fn() });
  });

  it('renders a compact role-aware contact row and exposes an accessible add-person form', async () => {
    const user = userEvent.setup();
    render(<DealContactsPanel dealId="deal-1" />);

    expect(screen.getByText('Avery Stone')).toBeInTheDocument();
    expect(screen.getByText('Managing Director · Stone Capital')).toBeInTheDocument();
    expect(screen.getByText('Sponsor contact')).toBeInTheDocument();
    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'avery@stone.example' })).toHaveAttribute(
      'href',
      'mailto:avery@stone.example',
    );

    await user.click(screen.getByRole('button', { name: 'Add person' }));

    expect(screen.getByRole('heading', { name: 'Add deal contact' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /full name/i })).toBeRequired();
    expect(screen.getByLabelText('Email')).toHaveAttribute('type', 'email');
    expect(screen.getByRole('combobox', { name: /role/i })).toHaveValue('source_contact');
    expect(screen.getByLabelText('Primary contact for this role')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Add contact' })).toBeInTheDocument();
  });

  it('retries only the link after the person was already created', async () => {
    const user = userEvent.setup();
    const createdContact = dealContact.contact_detail;
    const createAndLink = vi.fn().mockRejectedValue(
      new ContactCreatedButUnlinkedError(createdContact, new Error('primary conflict')),
    );
    const retryLink = vi.fn().mockResolvedValue(dealContact);
    contactApi.useCreateAndLinkContact.mockReturnValue({
      isPending: false,
      mutateAsync: createAndLink,
    });
    contactApi.useCreateDealContactLink.mockReturnValue({
      isPending: false,
      mutateAsync: retryLink,
    });
    render(<DealContactsPanel dealId="deal-1" />);

    await user.click(screen.getByRole('button', { name: 'Add person' }));
    await user.type(screen.getByRole('textbox', { name: /full name/i }), 'Avery Stone');
    await user.click(screen.getByRole('button', { name: 'Add contact' }));

    expect(await screen.findByRole('heading', { name: 'Finish linking contact' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry link' }));

    expect(createAndLink).toHaveBeenCalledOnce();
    expect(retryLink).toHaveBeenCalledWith({
      contact: createdContact.id,
      role: 'source_contact',
      is_primary: false,
      notes: '',
    });
  });
});
