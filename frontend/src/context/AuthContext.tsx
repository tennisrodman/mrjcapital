import { createContext, useState, useEffect, ReactNode } from 'react';
import { apiRequest, DEFAULT_HEADERS, endpoint, setTokens, clearTokens, getAccessToken, getRefreshToken } from '../config/api';

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
        // Logout is authorized by possession of the refresh token. Do not send the
        // access token: an expired Authorization header would make DRF reject the
        // request before the refresh token can be revoked.
        const refreshToken = getRefreshToken();
        await fetch(endpoint('api/auth/logout/'), {
          method: 'POST',
          headers: DEFAULT_HEADERS,
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
