import {
  ACCESS_TOKEN_KEY,
  LIVE_ACCESS_TOKEN_KEY,
  LIVE_REFRESH_TOKEN_KEY,
  MOCK_ACCESS_TOKEN,
  MOCK_REFRESH_TOKEN,
  REFRESH_TOKEN_KEY,
} from '@/config/authKeys';
import { USE_MOCKS } from '@/config/flags';

export const MOCKS_ENABLED = USE_MOCKS;

export function ensureMockSession(): void {
  if (!USE_MOCKS || typeof localStorage === 'undefined') return;

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

  if (accessToken !== MOCK_ACCESS_TOKEN || refreshToken !== MOCK_REFRESH_TOKEN) {
    localStorage.setItem(ACCESS_TOKEN_KEY, MOCK_ACCESS_TOKEN);
    localStorage.setItem(REFRESH_TOKEN_KEY, MOCK_REFRESH_TOKEN);
  }
}

export { mockApiRequest } from './handlers';
