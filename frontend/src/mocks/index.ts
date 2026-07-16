import { USE_MOCKS } from '@/config/flags';

export const MOCKS_ENABLED = USE_MOCKS;

export { ensureMockSession } from '@/config/mockSession';
export { mockApiRequest } from './handlers';
