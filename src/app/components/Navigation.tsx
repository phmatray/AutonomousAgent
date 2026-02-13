import type { Route } from '@/lib/router';

interface NavigationProps {
  currentRoute: Route;
  onNavigate: (route: Route) => void;
}

interface NavItem {
  route: Route;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { route: 'dashboard', label: 'Dashboard' },
  { route: 'backlog', label: 'Backlog' },
  { route: 'editor', label: 'Editor' },
  { route: 'monitoring', label: 'Monitoring' },
  { route: 'settings', label: 'Settings' },
];

export function Navigation({ currentRoute, onNavigate }: NavigationProps) {
  return (
    <nav
      className="flex items-center gap-2 bg-gray-900 border-b border-gray-700 px-3 overflow-x-auto"
      aria-label="Main navigation"
    >
      <span className="text-xs sm:text-sm font-bold text-indigo-400 mr-2 sm:mr-4 py-3 whitespace-nowrap shrink-0">
        Autonomous Agent
      </span>
      <ul className="flex items-center gap-1 min-w-max" role="menubar">
        {NAV_ITEMS.map(({ route, label }) => {
          const isActive = currentRoute === route;
          return (
            <li key={route} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => onNavigate(route)}
                className={`
                  px-2.5 sm:px-3 py-3 text-xs sm:text-sm font-medium transition-colors whitespace-nowrap
                  border-b-2 -mb-px
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900
                  ${isActive
                    ? 'text-white border-indigo-500'
                    : 'text-gray-400 border-transparent hover:text-gray-200 hover:border-gray-600'
                  }
                `}
                aria-current={isActive ? 'page' : undefined}
              >
                {label}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
