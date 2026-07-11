import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/apiError';
import type { Property } from '@/types/deal';
import { PropertyFactsDialog } from './PropertyFactsDialog';

const hooks = vi.hoisted(() => ({ updateProperty: vi.fn() }));
vi.mock('@/lib/api/deals', () => ({ useUpdateProperty: hooks.updateProperty }));

const property: Property = {
  id: 'property-1',
  address_normalized: '101 main st austin tx 78701',
  address: '101 Main St',
  city: 'Austin',
  state: 'TX',
  zip: '78701',
  property_type: 'multifamily',
  subtype: 'Garden style',
  units: 184,
  rentable_square_feet: 156400,
  year_built: 1988,
  year_renovated: 2021,
  county: 'Travis',
  msa: 'Austin',
  details: {},
};

describe('PropertyFactsDialog', () => {
  const mutate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    hooks.updateProperty.mockReturnValue({ mutate, isPending: false });
  });

  it('clears optional numeric facts to null and text facts to blank strings', async () => {
    const user = userEvent.setup();
    render(<PropertyFactsDialog property={property} open onOpenChange={vi.fn()} />);

    for (const label of ['Subtype', 'County', 'Units', 'Rentable square feet', 'Year built', 'Year renovated']) {
      await user.clear(screen.getByLabelText(label));
    }
    await user.click(screen.getByRole('button', { name: 'Save property facts' }));

    expect(mutate.mock.calls[0][0]).toEqual({
      subtype: '',
      units: null,
      rentable_square_feet: null,
      year_built: null,
      year_renovated: null,
      county: '',
    });
  });

  it('blocks a renovation year earlier than year built before calling the API', async () => {
    const user = userEvent.setup();
    render(<PropertyFactsDialog property={property} open onOpenChange={vi.fn()} />);

    await user.clear(screen.getByLabelText('Year renovated'));
    await user.type(screen.getByLabelText('Year renovated'), '1987');
    await user.click(screen.getByRole('button', { name: 'Save property facts' }));

    expect(screen.getByText('Year renovated cannot be earlier than year built')).toBeVisible();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('preserves in-progress edits when the live property object refetches', async () => {
    const user = userEvent.setup();
    const view = render(<PropertyFactsDialog property={property} open onOpenChange={vi.fn()} />);
    const subtype = screen.getByLabelText('Subtype');
    await user.clear(subtype);
    await user.type(subtype, 'Local edit');

    view.rerender(
      <PropertyFactsDialog
        property={{ ...property, subtype: 'Refetched value' }}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(subtype).toHaveValue('Local edit');
  });

  it('explains when an analyst cannot update a shared property', async () => {
    hooks.updateProperty.mockReturnValue({
      isPending: false,
      mutate: vi.fn((_payload, options) => options.onError(new ApiError('Forbidden', 403, {
        detail: 'A shared Sponsor or Property can only be changed by staff.',
      }))),
    });
    const user = userEvent.setup();
    render(<PropertyFactsDialog property={property} open onOpenChange={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Save property facts' }));

    expect(screen.getByRole('alert')).toHaveTextContent(
      'A shared Sponsor or Property can only be changed by staff.',
    );
  });
});
