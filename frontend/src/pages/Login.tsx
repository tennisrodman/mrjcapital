import { useContext, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Building2 } from 'lucide-react';
import { AuthContext } from '../context/AuthContext';
import { Button } from '@/components/ui/button';
import { FormField } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

const Login = () => {
  const { login, error, isAuthenticated, isLoading: isAuthLoading } = useContext(AuthContext);
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await login(username, password);
      navigate('/');
    } catch {
      // error is in context
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isAuthLoading && isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="relative flex min-h-screen flex-col bg-[var(--paper)] text-[var(--ink)]">
      <header className="relative border-b border-[var(--header-border)] bg-[var(--header-bg)]">
        <div className="header-grain pointer-events-none absolute inset-0 opacity-[0.35]" aria-hidden />
        <div className="relative mx-auto flex h-16 max-w-[1400px] items-center justify-between gap-4 px-6 lg:px-10">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-sm border border-[var(--brass)]/40 bg-[var(--brass)]/10 text-[var(--brass-light)]">
              <Building2 className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <span>
              <span className="font-display block text-[1.05rem] leading-none tracking-tight text-[var(--header-fg)]">
                MRJ Capital
              </span>
              <span className="mt-1 block text-[0.65rem] font-medium uppercase tracking-[0.22em] text-[var(--header-muted)]">
                Deal Desk
              </span>
            </span>
          </div>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-6 py-12 lg:px-10">
        <div className="w-full max-w-sm border border-[var(--border)] bg-[var(--paper-elevated)] p-8 shadow-sm">
          <p className="text-[0.65rem] font-medium uppercase tracking-[0.22em] text-[var(--slate)]">
            Internal access
          </p>
          <h1 className="font-display mt-2 text-2xl tracking-tight text-[var(--ink)]">Sign in</h1>
          <p className="mt-2 text-sm text-[var(--slate)]">
            Use your MRJ credentials to open the deal workspace.
          </p>

          {error ? (
            <p className="mt-4 rounded-sm border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <FormField label="Username" required>
              <Input
                id="login-username"
                type="text"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </FormField>
            <FormField label="Password" required>
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </FormField>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
};

export default Login;
