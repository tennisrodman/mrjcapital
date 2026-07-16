import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useContext } from 'react';

const api = vi.hoisted(() => ({
  clearTokens: vi.fn(),
  getRefreshToken: vi.fn(() => 'current-refresh-token'),
  request: vi.fn(),
}));

vi.mock('../config/api', () => ({
  apiRequest: api.request,
  DEFAULT_HEADERS: { 'Content-Type': 'application/json', Accept: 'application/json' },
  endpoint: (path: string) => `/${path}`,
  setTokens: vi.fn(),
  clearTokens: api.clearTokens,
  getAccessToken: vi.fn(() => 'expired-access-token'),
  getRefreshToken: api.getRefreshToken,
}));

import { AuthContext, AuthProvider } from './AuthContext';

function LogoutHarness() {
  const { isAuthenticated, logout } = useContext(AuthContext);
  return (
    <button type="button" onClick={() => void logout()}>
      {isAuthenticated ? 'Log out' : 'Loading'}
    </button>
  );
}

describe('AuthContext logout', () => {
  beforeEach(() => {
    api.clearTokens.mockReset();
    api.getRefreshToken.mockClear();
    api.request.mockReset().mockResolvedValue({
      username: 'analyst',
      email: 'analyst@example.com',
      is_staff: false,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
  });

  it('revokes with the refresh token without sending a possibly expired access token', async () => {
    render(
      <AuthProvider>
        <LogoutHarness />
      </AuthProvider>,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Log out' }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(fetch).toHaveBeenCalledWith('/api/auth/logout/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ refresh: 'current-refresh-token' }),
    });
    expect(api.clearTokens).toHaveBeenCalled();
  });
});
