import { lazy, Suspense } from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import { ErrorState, Spinner } from './components/deals/States';

const Login = lazy(() => import('./pages/Login'));
const HomePage = lazy(() => import('./pages/HomePage'));
const DealsListPage = lazy(() => import('./pages/deals/DealsListPage'));
const DealDetailPage = lazy(() => import('./pages/deals/DealDetailPage'));
const DealCreatePage = lazy(() => import('./pages/deals/DealCreatePage'));
const DealEditPage = lazy(() => import('./pages/deals/DealEditPage'));
const DealScreeningPage = lazy(() => import('./pages/deals/DealScreeningPage'));
const DealQuotePage = lazy(() => import('./pages/deals/DealQuotePage'));
const DealClosingPage = lazy(() => import('./pages/deals/DealClosingPage'));

function NotFoundPage() {
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <ErrorState
        title="Page not found"
        message="That URL is not part of MRJ Capital. Open the pipeline home or a deal workspace."
      />
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <Suspense fallback={<Spinner label="Loading workspace…" />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<ProtectedRoute />}>
              <Route index element={<HomePage />} />
              <Route path="deals" element={<DealsListPage />} />
              <Route path="deals/new" element={<DealCreatePage />} />
              <Route path="deals/:id" element={<DealDetailPage />} />
              <Route path="deals/:id/edit" element={<DealEditPage />} />
              <Route path="deals/:id/screening" element={<DealScreeningPage />} />
              <Route path="deals/:id/quotes" element={<DealQuotePage />} />
              <Route path="deals/:id/closing" element={<DealClosingPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </Router>
    </AuthProvider>
  );
}

export default App;
