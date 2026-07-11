import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/apiError';
import type { Sponsor } from '@/types/deal';
import { SponsorFactsDialog } from './SponsorFactsDialog';

const hooks = vi.hoisted(() => ({ updateSponsor: vi.fn() }));
vi.mock('@/lib/api/deals', () => ({ useUpdateSponsor: hooks.updateSponsor }));

const sponsor: Sponsor = {
  id: 'sponsor-1',
  entity_name: 'Larkspur Capital',
  entity_type: 'llc',
  primary_contact_name: 'Avery Stone',
  primary_contact_email: 'avery@example.com',
  primary_contact_phone: '555-0100',
  relationship_rating: 'established',
  website: 'https://larkspur.example',
  years_experience: 18,
  completed_projects: 27,
  bankruptcy_history: false,
  details: {},
};

describe('SponsorFactsDialog', () => {
  const mutate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    hooks.updateSponsor.mockReturnValue({ mutate, isPending: false });
  });

  it('clears optional facts without including immutable sponsor identity fields', async () => {
    const user = userEvent.setup();
    render(<SponsorFactsDialog sponsor={sponsor} open onOpenChange={vi.fn()} />);

    await user.clear(screen.getByLabelText('Website'));
    await user.clear(screen.getByLabelText('Years of experience'));
    await user.clear(screen.getByLabelText('Completed projects'));
    await user.selectOptions(screen.getByLabelText('Bankruptcy history'), '');
    await user.click(screen.getByRole('button', { name: 'Save sponsor facts' }));

    expect(mutate.mock.calls[0][0]).toEqual({
      website: '',
      years_experience: null,
      completed_projects: null,
      bankruptcy_history: null,
    });
    expect(screen.getByRole('option', { name: 'Unknown' })).toHaveValue('');
  });

  it('preserves in-progress edits when the live sponsor object refetches', async () => {
    const user = userEvent.setup();
    const view = render(<SponsorFactsDialog sponsor={sponsor} open onOpenChange={vi.fn()} />);
    const website = screen.getByLabelText('Website');
    await user.clear(website);
    await user.type(website, 'https://local-edit.example');

    view.rerender(
      <SponsorFactsDialog
        sponsor={{ ...sponsor, website: 'https://refetched.example' }}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(website).toHaveValue('https://local-edit.example');
  });

  it('preserves zero and displays backend field errors', async () => {
    hooks.updateSponsor.mockReturnValue({
      isPending: false,
      mutate: vi.fn((_payload, options) => options.onError(new ApiError('Bad request', 400, {
        years_experience: ['The value must be less than or equal to 200.'],
      }))),
    });
    const user = userEvent.setup();
    render(<SponsorFactsDialog sponsor={sponsor} open onOpenChange={vi.fn()} />);

    await user.clear(screen.getByLabelText('Years of experience'));
    await user.type(screen.getByLabelText('Years of experience'), '0');
    await user.click(screen.getByRole('button', { name: 'Save sponsor facts' }));

    expect(screen.getByText('The value must be less than or equal to 200.')).toBeVisible();
    expect(screen.getByText('Please fix the highlighted fields.')).toBeVisible();
  });

  it('explains when an analyst cannot update a shared sponsor', async () => {
    hooks.updateSponsor.mockReturnValue({
      isPending: false,
      mutate: vi.fn((_payload, options) => options.onError(new ApiError('Forbidden', 403, {
        detail: 'A shared Sponsor or Property can only be changed by staff.',
      }))),
    });
    const user = userEvent.setup();
    render(<SponsorFactsDialog sponsor={sponsor} open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Save sponsor facts' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'A shared Sponsor or Property can only be changed by staff.',
    );
  });
});
