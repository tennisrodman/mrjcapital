export const ACCESS_TOKEN_KEY = 'mrj_access_token';
export const REFRESH_TOKEN_KEY = 'mrj_refresh_token';
export const LIVE_ACCESS_TOKEN_KEY = 'mrj_live_access_token';
export const LIVE_REFRESH_TOKEN_KEY = 'mrj_live_refresh_token';

export const MOCK_ACCESS_TOKEN = 'mock-access-token';
export const MOCK_REFRESH_TOKEN = 'mock-refresh-token';

export function preserveLiveAuthTokens(): void {
  if (typeof localStorage === 'undefined') return;

  const accessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
  const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
  const hasLiveTokens =
    accessToken &&
    refreshToken &&
    accessToken !== MOCK_ACCESS_TOKEN &&
    refreshToken !== MOCK_REFRESH_TOKEN;

  if (hasLiveTokens) {
    localStorage.setItem(LIVE_ACCESS_TOKEN_KEY, accessToken);
    localStorage.setItem(LIVE_REFRESH_TOKEN_KEY, refreshToken);
  }
}
