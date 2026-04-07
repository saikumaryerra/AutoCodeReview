import { NavLink, Outlet } from 'react-router-dom';
import { LayoutDashboard, Search, Settings, GitPullRequest } from 'lucide-react';
import { StatusIndicator } from './StatusIndicator';
import { useStatus } from '../hooks/useStatus';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/search', icon: Search, label: 'Search' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export function Layout() {
  const { data: status } = useStatus();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col bg-gray-900 text-gray-300 shrink-0">
        <div className="flex items-center gap-2 border-b border-gray-800 px-5 py-4">
          <GitPullRequest className="h-6 w-6 text-indigo-400" />
          <h1 className="text-lg font-bold text-white">AutoCodeReview</h1>
        </div>

        <nav className="mt-4 flex-1 space-y-1 px-3">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
                }`
              }
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-gray-800 px-5 py-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Claude CLI</span>
            <StatusIndicator available={status?.claude_cli_available ?? false} />
          </div>
          {status && (
            <p className="mt-1 text-xs text-gray-500">
              Queue: {status.queue_depth} pending
            </p>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-gray-50">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
