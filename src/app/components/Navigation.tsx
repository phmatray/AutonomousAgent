import type { Route } from '@/lib/router';
import type { ComponentType } from 'react';
import {
  Activity,
  LayoutDashboard,
  ListTodo,
  Settings,
} from 'lucide-react';

interface NavigationProps {
  currentRoute: Route;
  onNavigate: (route: Route) => void;
}

interface NavItem {
  route: Route;
  label: string;
  icon: ComponentType<{ size?: number; className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  { route: 'backlog', label: 'Backlog', icon: ListTodo },
  { route: 'dashboard', label: 'Workflows', icon: LayoutDashboard },
  { route: 'monitoring', label: 'Monitoring', icon: Activity },
  { route: 'settings', label: 'Settings', icon: Settings },
];

export function Navigation({ currentRoute, onNavigate }: NavigationProps) {
  return (
    <nav
      className="flex items-center gap-3 bg-gray-900/95 border-b border-gray-700 px-3 overflow-x-auto shadow-sm"
      aria-label="Main navigation"
    >
      <span className="text-xs sm:text-sm font-bold text-indigo-300 mr-2 sm:mr-3 py-3 whitespace-nowrap shrink-0">
        Autonomous Agent
      </span>
      <ul className="flex items-center gap-1 min-w-max" role="menubar">
        {NAV_ITEMS.map(({ route, label, icon: Icon }) => {
          const isActive = currentRoute === route;
          return (
            <li key={route} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => onNavigate(route)}
                className={`
                  inline-flex items-center gap-2 rounded-t-md px-2.5 sm:px-3 py-2.5 text-xs sm:text-sm font-medium transition-all whitespace-nowrap
                  border-b-2 -mb-px
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900
                  ${isActive
                    ? 'text-indigo-300 bg-gray-800/80 border-indigo-400'
                    : 'text-gray-300 border-transparent hover:text-white hover:bg-gray-800/50 hover:border-gray-600'
                  }
                `}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon size={14} className={isActive ? 'text-indigo-300' : 'text-gray-400'} aria-hidden="true" />
                {label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
