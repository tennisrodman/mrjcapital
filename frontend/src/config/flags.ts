import {
  ACCESS_TOKEN_KEY,
  LIVE_ACCESS_TOKEN_KEY,
  LIVE_REFRESH_TOKEN_KEY,
  MOCK_ACCESS_TOKEN,
  MOCK_REFRESH_TOKEN,
  REFRESH_TOKEN_KEY,
} from './authKeys';

export type DataMode = 'mock' | 'live';

export const DATA_MODE_KEY = 'mrj_data_mode';
/** Demo-only: when true, mock auth exposes staff powers (overrides, force supersede, relationship edits). */
export const DEMO_STAFF_KEY = 'mrj_demo_is_staff';

const envDefault: DataMode = import.meta.env.VITE_USE_MOCKS !== 'false' ? 'mock' : 'live';

function readMode(): DataMode {
  if (typeof localStorage === 'undefined') return envDefault;
  const stored = localStorage.getItem(DATA_MODE_KEY);
  return stored === 'mock' || stored === 'live' ? stored : envDefault;
}

export const DATA_MODE = readMode();
export const USE_MOCKS = DATA_MODE === 'mock';

/** In-memory override so Demo mock tests can flip staff without a full reload. */
let demoStaffMemory: boolean | null = null;

function readStoredDemoStaff(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(DEMO_STAFF_KEY) === 'true';
}

/** Demo persona: default analyst (`false`). Staff powers require the Demo staff toggle. */
export function getDemoIsStaff(): boolean {
  if (demoStaffMemory !== null) return demoStaffMemory;
  return readStoredDemoStaff();
}

function reloadPreservingListPath(): void {
  const nextPath = listPathForEntityDetail(window.location.pathname);
  location.assign(`${nextPath}${window.location.search}${window.location.hash}`);
}

export function setDataMode(mode: DataMode): void {
  if (typeof localStorage !== 'undefined') {
    const currentAccessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
    const currentRefreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
    const hasLiveTokens =
      currentAccessToken &&
      currentRefreshToken &&
      currentAccessToken !== MOCK_ACCESS_TOKEN &&
      currentRefreshToken !== MOCK_REFRESH_TOKEN;

    if (hasLiveTokens) {
      localStorage.setItem(LIVE_ACCESS_TOKEN_KEY, currentAccessToken);
      localStorage.setItem(LIVE_REFRESH_TOKEN_KEY, currentRefreshToken);
    }

    localStorage.setItem(DATA_MODE_KEY, mode);

    if (mode === 'mock') {
      localStorage.setItem(ACCESS_TOKEN_KEY, MOCK_ACCESS_TOKEN);
      localStorage.setItem(REFRESH_TOKEN_KEY, MOCK_REFRESH_TOKEN);
    } else {
      const liveAccessToken = localStorage.getItem(LIVE_ACCESS_TOKEN_KEY);
      const liveRefreshToken = localStorage.getItem(LIVE_REFRESH_TOKEN_KEY);
      if (liveAccessToken && liveRefreshToken) {
        localStorage.setItem(ACCESS_TOKEN_KEY, liveAccessToken);
        localStorage.setItem(REFRESH_TOKEN_KEY, liveRefreshToken);
      } else {
        localStorage.removeItem(ACCESS_TOKEN_KEY);
        localStorage.removeItem(REFRESH_TOKEN_KEY);
      }
    }
  }

  reloadPreservingListPath();
}

/** Flip Demo staff persona and reload so AuthContext + mock handlers agree. */
export function setDemoStaff(isStaff: boolean): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(DEMO_STAFF_KEY, isStaff ? 'true' : 'false');
  }
  demoStaffMemory = isStaff;
  reloadPreservingListPath();
}

/** Test helper: change Demo staff without a navigation reload. */
export function setDemoIsStaffForTests(isStaff: boolean): void {
  demoStaffMemory = isStaff;
}

/** Entity detail URLs (e.g. /deals/:id/...) redirect to the list on Demo/Live switch. */
export function listPathForEntityDetail(pathname: string): string {
  if (/^\/deals\/(?!new(?:\/|$))[^/]+/.test(pathname)) {
    return '/deals';
  }
  return pathname;
}
