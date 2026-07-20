import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Quote } from '@/types/quote';
import { QuoteActions } from './QuoteActions';

const actions = {
  onSave: vi.fn(),
  onSend: vi.fn(),
  onCounter: vi.fn(),
  onExecute: vi.fn(),
  onWithdraw: vi.fn(),
  onExpire: vi.fn(),
};

function sentQuote(expiresAt: string): Quote {
  return {
    id: 'quote-1',
    is_current: true,
    status: 'sent',
    expires_at: expiresAt,
    attachments: ['document-1'],
  } as Quote;
}

describe('QuoteActions effective expiry', () => {
  it('offers negotiation actions before expiry and not an early Expire action', () => {
    render(
      <QuoteActions
        quote={sentQuote('2999-01-01T00:00:00Z')}
        dirty={false}
        {...actions}
      />,
    );

    expect(screen.getByRole('button', { name: 'Counter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Execute' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Expire' })).not.toBeInTheDocument();
  });

  it('blocks counter/execute and offers Expire after the deadline', () => {
    render(
      <QuoteActions
        quote={sentQuote('2000-01-01T00:00:00Z')}
        dirty={false}
        {...actions}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Counter' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Execute' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expire' })).toBeInTheDocument();
    expect(screen.getByText(/quote is past due/i)).toBeInTheDocument();
  });
});
