import { useState, useEffect, useCallback } from 'react';

export type Route = 'dashboard' | 'editor' | 'monitoring' | 'settings';

function getRouteFromHash(): Route {
  const hash = window.location.hash.replace('#/', '').replace('#', '');
  const valid: Route[] = ['dashboard', 'editor', 'monitoring', 'settings'];
  return valid.includes(hash as Route) ? (hash as Route) : 'dashboard';
}

export function useRouter(): {
  route: Route;
  navigate: (route: Route) => void;
  params: URLSearchParams;
} {
  const [route, setRoute] = useState<Route>(getRouteFromHash);

  useEffect(() => {
    function onHashChange() {
      setRoute(getRouteFromHash());
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = useCallback((newRoute: Route) => {
    window.location.hash = `#/${newRoute}`;
  }, []);

  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');

  return { route, navigate, params };
}
