// Mock API toggle. On by default in `npm run dev` so every deal view renders with
// realistic example data and no backend. Disable with VITE_USE_MOCKS=false to hit
// the real Django API. Always off in production builds — production uses Postgres
// data loaded via `python manage.py seed_demo_data` (see shared/demo_seed.json).
export const MOCKS_ENABLED =
  import.meta.env.DEV && import.meta.env.VITE_USE_MOCKS !== 'false';

// Seed throwaway auth tokens so ProtectedRoute lets you straight into the app —
// the mock handler answers /auth/user/ with a staff user.
if (MOCKS_ENABLED && typeof localStorage !== 'undefined') {
  if (!localStorage.getItem('mrj_access_token')) {
    localStorage.setItem('mrj_access_token', 'mock-access-token');
    localStorage.setItem('mrj_refresh_token', 'mock-refresh-token');
  }
}

export { mockApiRequest } from './handlers';
