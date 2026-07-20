import { beforeEach, describe, expect, it } from 'vitest';

import {
  ACCESS_TOKEN_KEY,
  LIVE_ACCESS_TOKEN_KEY,
  LIVE_REFRESH_TOKEN_KEY,
  MOCK_ACCESS_TOKEN,
  MOCK_REFRESH_TOKEN,
  REFRESH_TOKEN_KEY,
} from './authKeys';
import { migrateLegacyDemoSession } from './legacyDemoSession';

const LEGACY_DATA_MODE_KEY = 'mrj_data_mode';
const LEGACY_DEMO_STAFF_KEY = 'mrj_demo_is_staff';

describe('migrateLegacyDemoSession', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('restores a complete saved Live session when Demo sentinels are primary', () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, MOCK_ACCESS_TOKEN);
    localStorage.setItem(REFRESH_TOKEN_KEY, MOCK_REFRESH_TOKEN);
    localStorage.setItem(LIVE_ACCESS_TOKEN_KEY, 'saved-live-access');
    localStorage.setItem(LIVE_REFRESH_TOKEN_KEY, 'saved-live-refresh');
    localStorage.setItem(LEGACY_DATA_MODE_KEY, 'mock');
    localStorage.setItem(LEGACY_DEMO_STAFF_KEY, 'true');

    migrateLegacyDemoSession();

    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('saved-live-access');
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('saved-live-refresh');
    expectLegacyKeysRemoved();
  });

  it('clears both primary tokens when a mock credential has no complete Live backup', () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, MOCK_ACCESS_TOKEN);
    localStorage.setItem(REFRESH_TOKEN_KEY, 'unexpected-refresh');
    localStorage.setItem(LIVE_ACCESS_TOKEN_KEY, 'orphaned-live-access');

    migrateLegacyDemoSession();

    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
    expectLegacyKeysRemoved();
  });

  it('preserves a current non-mock session and removes all legacy state', () => {
    localStorage.setItem(ACCESS_TOKEN_KEY, 'current-live-access');
    localStorage.setItem(REFRESH_TOKEN_KEY, 'current-live-refresh');
    localStorage.setItem(LIVE_ACCESS_TOKEN_KEY, 'older-live-access');
    localStorage.setItem(LIVE_REFRESH_TOKEN_KEY, 'older-live-refresh');
    localStorage.setItem(LEGACY_DATA_MODE_KEY, 'live');
    localStorage.setItem(LEGACY_DEMO_STAFF_KEY, 'false');

    migrateLegacyDemoSession();

    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBe('current-live-access');
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBe('current-live-refresh');
    expectLegacyKeysRemoved();
  });

  it('does not resurrect a saved session after the primary session was cleared', () => {
    localStorage.setItem(LIVE_ACCESS_TOKEN_KEY, 'stale-live-access');
    localStorage.setItem(LIVE_REFRESH_TOKEN_KEY, 'stale-live-refresh');

    migrateLegacyDemoSession();

    expect(localStorage.getItem(ACCESS_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(REFRESH_TOKEN_KEY)).toBeNull();
    expectLegacyKeysRemoved();
  });
});

function expectLegacyKeysRemoved(): void {
  expect(localStorage.getItem(LEGACY_DATA_MODE_KEY)).toBeNull();
  expect(localStorage.getItem(LEGACY_DEMO_STAFF_KEY)).toBeNull();
  expect(localStorage.getItem(LIVE_ACCESS_TOKEN_KEY)).toBeNull();
  expect(localStorage.getItem(LIVE_REFRESH_TOKEN_KEY)).toBeNull();
}
