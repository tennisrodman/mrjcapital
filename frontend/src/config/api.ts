import { MOCKS_ENABLED, mockApiRequest } from '@/mocks';
import { ApiError } from '@/lib/apiError';

export { ApiError, apiErrorMessage, fieldErrors } from '@/lib/apiError';

export const API_URL =
  process.env.REACT_APP_API_URL ||
  (typeof window !== 'undefined' ? `${window.location.protocol}//${window.location.host}` : '') ||
  '';

export const ACCESS_TOKEN_KEY = 'mrj_access_token';
export const REFRESH_TOKEN_KEY = 'mrj_refresh_token';

export const getAccessToken = (): string | null => localStorage.getItem(ACCESS_TOKEN_KEY);
export const getRefreshToken = (): string | null => localStorage.getItem(REFRESH_TOKEN_KEY);

export const setTokens = (accessToken: string, refreshToken: string): void => {
  localStorage.setItem(ACCESS_TOKEN_KEY, accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
};

export const clearTokens = (): void => {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
};

export const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
};

export const getAuthHeaders = (): HeadersInit => {
  const accessToken = getAccessToken();
  return accessToken
    ? { ...DEFAULT_HEADERS, 'Authorization': `Bearer ${accessToken}` }
    : DEFAULT_HEADERS;
};

export const endpoint = (path: string): string => {
  const formatted = path.startsWith('/') ? path.substring(1) : path;
  return `${API_URL}/${formatted}`;
};

let isRefreshing = false;
let refreshSubscribers: { resolve: (token: string) => void; reject: (err: Error) => void }[] = [];

const subscribeTokenRefresh = (resolve: (token: string) => void, reject: (err: Error) => void) =>
  refreshSubscribers.push({ resolve, reject });

const notifySubscribers = (token: string) => {
  refreshSubscribers.forEach(({ resolve }) => resolve(token));
  refreshSubscribers = [];
};

const rejectSubscribers = (err: Error) => {
  refreshSubscribers.forEach(({ reject }) => reject(err));
  refreshSubscribers = [];
};

const refreshAccessToken = async (): Promise<string> => {
  const refreshToken = getRefreshToken();
  if (!refreshToken) throw new Error('No refresh token available');

  const response = await fetch(endpoint('api/auth/token/refresh/'), {
    method: 'POST',
    headers: DEFAULT_HEADERS,
    body: JSON.stringify({ refresh: refreshToken }),
  });

  if (!response.ok) {
    clearTokens();
    throw new Error('Token refresh failed');
  }

  const data = await response.json();
  localStorage.setItem(ACCESS_TOKEN_KEY, data.access);
  if (data.refresh) {
    localStorage.setItem(REFRESH_TOKEN_KEY, data.refresh);
  }
  return data.access;
};

export const apiRequest = async <T>(path: string, options: RequestInit = {}): Promise<T> => {
  if (MOCKS_ENABLED) return mockApiRequest<T>(path, options);

  const url = endpoint(path);
  let fetchOptions: RequestInit = {
    mode: 'cors',
    ...options,
    headers: { ...getAuthHeaders(), ...(options.headers || {}) },
  };

  let response = await fetch(url, fetchOptions);

  if (response.status === 401) {
    const errorData = await response.json();
    if (errorData.code === 'token_not_valid') {
      if (!isRefreshing) {
        isRefreshing = true;
        try {
          const newToken = await refreshAccessToken();
          notifySubscribers(newToken);
          fetchOptions.headers = { ...fetchOptions.headers, 'Authorization': `Bearer ${newToken}` };
          response = await fetch(url, fetchOptions);
        } catch (err) {
          rejectSubscribers(err instanceof Error ? err : new Error('Token refresh failed'));
          throw err;
        } finally {
          isRefreshing = false;
        }
      } else {
        const newToken = await new Promise<string>((resolve, reject) =>
          subscribeTokenRefresh(resolve, reject)
        );
        fetchOptions.headers = { ...fetchOptions.headers, 'Authorization': `Bearer ${newToken}` };
        response = await fetch(url, fetchOptions);
      }
    } else {
      // Non-token 401 (e.g. custom permission denied) — body already consumed, throw now
      throw new ApiError(
        errorData?.error || `API request failed: ${response.status}`,
        response.status,
        errorData,
      );
    }
  }

  if (!response.ok) {
    let errorData;
    try { errorData = await response.json(); } catch { /* ignore */ }
    throw new ApiError(
      errorData?.error || errorData?.detail || `API request failed: ${response.status}`,
      response.status,
      errorData,
    );
  }

  if (response.status === 204) return {} as T;
  return response.json() as Promise<T>;
};
