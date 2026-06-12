import { createContext, useState, useEffect, ReactNode } from 'react';
import { apiRequest, endpoint, getAuthHeaders, setTokens, clearTokens, getAccessToken, getRefreshToken } from '../config/api';

interface User {
  username: string;
  email: string;
  is_staff: boolean;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
  login: async () => {},
  logout: async () => {},
});

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        if (!getAccessToken() || !getRefreshToken()) return;
        const userData = await apiRequest<User>('api/auth/user/');
        setUser(userData);
        setIsAuthenticated(true);
      } catch {
        clearTokens();
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const login = async (username: string, password: string) => {
    setError(null);
    try {
      const response = await fetch(endpoint('api/auth/login/'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Login failed');
      }
      const data = await response.json();
      setTokens(data.tokens.access, data.tokens.refresh);
      const userData = await apiRequest<User>('api/auth/user/');
      setUser(userData);
      setIsAuthenticated(true);
    } catch (err) {
      clearTokens();
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
      throw err;
    }
  };

  const logout = async () => {
    try {
      if (isAuthenticated) {
        // Use raw fetch to avoid apiRequest's implicit token-refresh-on-401 retry:
        // if the access token has expired, apiRequest would exchange the old refresh
        // token for a new one, then send the stale refresh token to logout — leaving
        // the newly-issued refresh token valid. Reading the refresh token here (after
        // any prior refresh) and bypassing the retry ensures the correct token is blacklisted.
        const refreshToken = getRefreshToken();
        await fetch(endpoint('api/auth/logout/'), {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ refresh: refreshToken }),
        });
      }
    } catch { /* ignore */ } finally {
      clearTokens();
      setUser(null);
      setIsAuthenticated(false);
    }
  };

  return (
    <AuthContext.Provider value={{ user, isAuthenticated, isLoading, login, logout, error }}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
