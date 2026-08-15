import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

interface ProtectedRouteProps {
  children: ReactNode;
}

/**
 * Every protected page used to run its own `useEffect` checking only
 * `isAuthenticated`, which is `false` both when there is genuinely no session
 * and while `AuthContext` is still waiting on `GET /auth/me` to resolve on
 * mount — so an authenticated user reloading a protected page was briefly
 * redirected to `/login` before the check finished (C7). Centralising the
 * guard here means the loading state is only handled in one place.
 */
export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <div className="loading">Загрузка...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
