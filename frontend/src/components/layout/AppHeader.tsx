import { useContext } from 'react';
import { NavLink } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Building2, ChevronDown, FileText, LayoutDashboard, LogOut, Plus, Scale } from 'lucide-react';
import { AuthContext } from '@/context/AuthContext';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/deals', label: 'Deals', icon: Scale, disabled: true },
  { to: '/documents', label: 'Documents', icon: FileText, disabled: true },
] as const;

const AppHeader = () => {
  const { user, logout } = useContext(AuthContext);
  const initials = user?.username?.slice(0, 2).toUpperCase() ?? '?';

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--header-border)] bg-[var(--header-bg)]">
      <div className="header-grain pointer-events-none absolute inset-0 opacity-[0.35]" aria-hidden />

      <div className="relative mx-auto flex h-16 max-w-[1400px] items-center gap-8 px-6 lg:px-10">
        <div className="flex min-w-0 items-center gap-10">
          <NavLink to="/" className="group flex shrink-0 items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-sm border border-[var(--brass)]/40 bg-[var(--brass)]/10 text-[var(--brass-light)] transition-colors group-hover:border-[var(--brass)]/70 group-hover:bg-[var(--brass)]/15">
              <Building2 className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <span className="hidden sm:block">
              <span className="font-display block text-[1.05rem] leading-none tracking-tight text-[var(--header-fg)]">
                MRJ Capital
              </span>
              <span className="mt-1 block text-[0.65rem] font-medium uppercase tracking-[0.22em] text-[var(--header-muted)]">
                Deal Desk
              </span>
            </span>
          </NavLink>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
            {navItems.map(({ to, label, icon: Icon, ...rest }) => {
              const disabled = 'disabled' in rest && rest.disabled;

              if (disabled) {
                return (
                  <span
                    key={label}
                    className="flex cursor-not-allowed items-center gap-2 rounded-sm px-3 py-2 text-sm text-[var(--header-muted)]/60"
                    title="Coming soon"
                  >
                    <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                    {label}
                  </span>
                );
              }

              return (
                <NavLink
                  key={label}
                  to={to}
                  end={'end' in rest ? rest.end : false}
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-2 rounded-sm px-3 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-[var(--brass)]/12 text-[var(--brass-light)]'
                        : 'text-[var(--header-muted)] hover:bg-white/5 hover:text-[var(--header-fg)]'
                    )
                  }
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                  {label}
                </NavLink>
              );
            })}
          </nav>
        </div>

        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            disabled
            title="Coming soon"
            className="hidden items-center gap-2 rounded-sm border border-[var(--brass)]/30 bg-[var(--brass)]/10 px-3 py-1.5 text-sm font-medium text-[var(--brass-light)] opacity-60 lg:inline-flex"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2} />
            New deal
          </button>

          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 rounded-sm border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-[var(--header-fg)] transition-colors hover:border-white/20 hover:bg-white/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brass)]/50"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-[var(--brass)]/20 text-xs font-semibold tracking-wide text-[var(--brass-light)]">
                  {initials}
                </span>
                <span className="hidden max-w-[120px] truncate text-left sm:block">
                  <span className="block text-sm leading-tight">{user?.username}</span>
                  <span className="block text-[0.65rem] uppercase tracking-wider text-[var(--header-muted)]">
                    {user?.is_staff ? 'Admin' : 'Analyst'}
                  </span>
                </span>
                <ChevronDown className="hidden h-3.5 w-3.5 text-[var(--header-muted)] sm:block" />
              </button>
            </DropdownMenu.Trigger>

            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={8}
                className="z-50 min-w-[200px] rounded-md border border-[var(--border)] bg-[var(--paper-elevated)] p-1 shadow-xl animate-in fade-in-0 zoom-in-95"
              >
                <div className="border-b border-[var(--border)] px-3 py-2.5">
                  <p className="truncate text-sm font-medium text-[var(--ink)]">{user?.username}</p>
                  <p className="truncate text-xs text-[var(--slate)]">{user?.email}</p>
                </div>
                <DropdownMenu.Item
                  className="mt-1 flex cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-sm text-[var(--ink)] outline-none hover:bg-[var(--paper)] focus:bg-[var(--paper)]"
                  onSelect={() => void logout()}
                >
                  <LogOut className="h-3.5 w-3.5 text-[var(--slate)]" />
                  Sign out
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      </div>
    </header>
  );
};

export default AppHeader;
