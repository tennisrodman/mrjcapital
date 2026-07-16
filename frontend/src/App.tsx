import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import { ErrorState } from './components/deals/States';
import Login from './pages/Login';
import HomePage from './pages/HomePage';
import DealsListPage from './pages/deals/DealsListPage';
import DealDetailPage from './pages/deals/DealDetailPage';
import DealCreatePage from './pages/deals/DealCreatePage';
import DealEditPage from './pages/deals/DealEditPage';
import DealScreeningPage from './pages/deals/DealScreeningPage';
import DealQuotePage from './pages/deals/DealQuotePage';
import DealClosingPage from './pages/deals/DealClosingPage';

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
      </Router>
    </AuthProvider>
  );
}

export default App;
