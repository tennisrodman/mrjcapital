import { Outlet } from 'react-router-dom';
import AppHeader from './AppHeader';

const AppLayout = () => (
  <div className="min-h-screen bg-[var(--paper)] text-[var(--ink)]">
    <AppHeader />
    <main className="mx-auto max-w-[1400px] px-6 py-8 lg:px-10 lg:py-10">
      <Outlet />
    </main>
  </div>
);

export default AppLayout;
