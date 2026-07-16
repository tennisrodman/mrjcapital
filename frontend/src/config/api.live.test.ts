import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, apiRequest, getAccessToken, getRefreshToken } from './api';
import { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY } from './authKeys';

describe('apiRequest Live adapter', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('refreshes a rejected access token, stores rotation, and retries with the new token', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'expired-access');
    localStorage.setItem(REFRESH_TOKEN_KEY, 'current-refresh');
    const responses = [
      jsonResponse({ code: 'token_not_valid' }, 401),
      jsonResponse({ access: 'new-access', refresh: 'rotated-refresh' }),
      jsonResponse({ id: 'deal-1' }),
    ];
    const authorizationAtCall: Array<string | undefined> = [];
    const fetchMock = vi.fn((_url: string, options?: RequestInit) => {
      authorizationAtCall.push(
        (options?.headers as Record<string, string> | undefined)?.Authorization,
      );
      return Promise.resolve(responses.shift()!);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest<{ id: string }>('api/deals/deal-1/')).resolves.toEqual({ id: 'deal-1' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toContain('/api/deals/deal-1/');
    expect(authorizationAtCall).toEqual([
      'Bearer expired-access',
      undefined,
      'Bearer new-access',
    ]);
    expect(fetchMock.mock.calls[1][0]).toContain('/api/auth/token/refresh/');
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      refresh: 'current-refresh',
    });
    expect(getAccessToken()).toBe('new-access');
    expect(getRefreshToken()).toBe('rotated-refresh');
  });

  it('preserves a non-token authorization error without attempting refresh', async () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'valid-access');
    localStorage.setItem(REFRESH_TOKEN_KEY, 'valid-refresh');
    const body = { code: 'permission_denied', detail: 'You cannot access this deal.' };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(body, 401));
    vi.stubGlobal('fetch', fetchMock);

    const error = await apiRequest('api/deals/private/').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, data: body });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getAccessToken()).toBe('valid-access');
    expect(getRefreshToken()).toBe('valid-refresh');
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
