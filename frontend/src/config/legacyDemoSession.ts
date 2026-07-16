import {
  ACCESS_TOKEN_KEY,
  LIVE_ACCESS_TOKEN_KEY,
  LIVE_REFRESH_TOKEN_KEY,
  MOCK_ACCESS_TOKEN,
  MOCK_REFRESH_TOKEN,
  REFRESH_TOKEN_KEY,
} from './authKeys';

const LEGACY_DATA_MODE_KEY = 'mrj_data_mode';
const LEGACY_DEMO_STAFF_KEY = 'mrj_demo_is_staff';

function isMockCredential(value: string | null): boolean {
  return value === MOCK_ACCESS_TOKEN || value === MOCK_REFRESH_TOKEN;
}

function isUsableLivePair(accessToken: string | null, refreshToken: string | null): boolean {
  return Boolean(
    accessToken
      && refreshToken
      && !isMockCredential(accessToken)
      && !isMockCredential(refreshToken),
  );
}

/**
 * Remove browser state left by the former Demo/Live switch.
 *
 * Demo mode replaced the primary token pair with sentinels while preserving a
 * real Live pair in backup keys. Restore that complete Live pair when possible;
 * otherwise clear the unusable primary pair so AuthContext opens at sign-in.
 * A missing primary pair is treated as an intentional logout and is never
 * resurrected from stale backup credentials.
 */
export function migrateLegacyDemoSession(storage: Storage | undefined = globalThis.localStorage): void {
  if (!storage) return;

  const accessToken = storage.getItem(ACCESS_TOKEN_KEY);
  const refreshToken = storage.getItem(REFRESH_TOKEN_KEY);
  const primaryContainsMockCredential =
    isMockCredential(accessToken) || isMockCredential(refreshToken);

  if (primaryContainsMockCredential) {
    const savedAccessToken = storage.getItem(LIVE_ACCESS_TOKEN_KEY);
    const savedRefreshToken = storage.getItem(LIVE_REFRESH_TOKEN_KEY);
    if (isUsableLivePair(savedAccessToken, savedRefreshToken)) {
      storage.setItem(ACCESS_TOKEN_KEY, savedAccessToken!);
      storage.setItem(REFRESH_TOKEN_KEY, savedRefreshToken!);
    } else {
      storage.removeItem(ACCESS_TOKEN_KEY);
      storage.removeItem(REFRESH_TOKEN_KEY);
    }
  }

  storage.removeItem(LEGACY_DATA_MODE_KEY);
  storage.removeItem(LEGACY_DEMO_STAFF_KEY);
  storage.removeItem(LIVE_ACCESS_TOKEN_KEY);
  storage.removeItem(LIVE_REFRESH_TOKEN_KEY);
}
