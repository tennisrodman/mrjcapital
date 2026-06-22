import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Login from './pages/Login';
import HomePage from './pages/HomePage';
import DealsListPage from './pages/deals/DealsListPage';
import DealDetailPage from './pages/deals/DealDetailPage';
import DealCreatePage from './pages/deals/DealCreatePage';
import DealEditPage from './pages/deals/DealEditPage';

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
          </Route>
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
