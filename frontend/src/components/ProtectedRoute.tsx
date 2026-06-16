import { useContext } from 'react';
import { Navigate } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import { AuthContext } from '../context/AuthContext';

const ProtectedRoute = () => {
  const { isAuthenticated, isLoading } = useContext(AuthContext);
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--paper)]">
        <div className="flex flex-col items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-sm border border-[var(--brass)]/30 bg-[var(--brass)]/10">
            <span className="h-4 w-4 animate-pulse rounded-sm bg-[var(--brass)]/40" />
          </span>
          <p className="text-sm text-[var(--slate)]">Loading workspace…</p>
        </div>
      </div>
    );
  }
  return isAuthenticated ? (
    <AppLayout />
  ) : (
    <Navigate to="/login" replace />
  );
};

export default ProtectedRoute;
