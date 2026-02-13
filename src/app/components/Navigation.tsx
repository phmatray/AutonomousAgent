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
  { route: 'editor', label: 'Editor' },
  { route: 'monitoring', label: 'Monitoring' },
  { route: 'settings', label: 'Settings' },
];

export function Navigation({ currentRoute, onNavigate }: NavigationProps) {
  return (
    <nav
      className="flex items-center gap-1 bg-gray-900 border-b border-gray-700 px-4"
      aria-label="Main navigation"
    >
      <span className="text-sm font-bold text-indigo-400 mr-4 py-3">
        Autonomous Agent
      </span>
      <ul className="flex items-center gap-1" role="menubar">
        {NAV_ITEMS.map(({ route, label }) => {
          const isActive = currentRoute === route;
          return (
            <li key={route} role="none">
              <button
                type="button"
                role="menuitem"
                onClick={() => onNavigate(route)}
                className={`
                  px-3 py-3 text-sm font-medium transition-colors
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
