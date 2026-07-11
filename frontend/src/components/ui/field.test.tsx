import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FormField } from './field';
import { Input } from './input';

function WrappedControl() {
  return (
    <div className="currency-control">
      <span>$</span>
      <Input />
    </div>
  );
}

describe('FormField', () => {
  it('associates its label and helper text with a control nested in a currency wrapper', () => {
    render(
      <FormField label="Estimated property value" hint="Optional">
        <div>
          <span>$</span>
          <Input />
        </div>
      </FormField>,
    );

    const input = screen.getByLabelText('Estimated property value');
    expect(input).toHaveAccessibleDescription('Optional');
  });

  it('announces validation errors and connects them to the control', () => {
    render(
      <FormField label="Requested amount" error="Enter an amount greater than zero">
        <Input />
      </FormField>,
    );

    const input = screen.getByLabelText('Requested amount');
    expect(input).toHaveAccessibleDescription('Enter an amount greater than zero');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter an amount greater than zero');
  });

  it('connects a control rendered inside a custom wrapper component', () => {
    render(
      <FormField label="Renovation budget" hint="Optional">
        <WrappedControl />
      </FormField>,
    );

    expect(screen.getByLabelText('Renovation budget')).toHaveAccessibleDescription('Optional');
  });

  it('preserves explicit IDs and merges explicit descriptions with field help', () => {
    render(
      <>
        <p id="currency-format">Enter dollars</p>
        <FormField label="Requested amount" hint="Required currency">
          <Input id="requested-amount" aria-describedby="currency-format" />
        </FormField>
      </>,
    );

    const input = screen.getByLabelText('Requested amount');
    expect(input).toHaveAttribute('id', 'requested-amount');
    expect(input).toHaveAccessibleDescription('Enter dollars Required currency');
  });
});
