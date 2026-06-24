import { ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY } from './authKeys';

export type DataMode = 'mock' | 'live';

export const DATA_MODE_KEY = 'mrj_data_mode';

const envDefault: DataMode = import.meta.env.VITE_USE_MOCKS !== 'false' ? 'mock' : 'live';

function readMode(): DataMode {
  if (typeof localStorage === 'undefined') return envDefault;
  const stored = localStorage.getItem(DATA_MODE_KEY);
  return stored === 'mock' || stored === 'live' ? stored : envDefault;
}

export const DATA_MODE = readMode();
export const USE_MOCKS = DATA_MODE === 'mock';

export function setDataMode(mode: DataMode): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(DATA_MODE_KEY, mode);
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }

  location.assign('/');
}
