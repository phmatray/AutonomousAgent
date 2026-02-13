import { useState, useEffect, useCallback } from 'react';

export type Route = 'dashboard' | 'editor' | 'monitoring' | 'settings';

function getRouteFromHash(): Route {
  const hash = window.location.hash.replace('#/', '').replace('#', '');
  // Extract route part before query string
  const routePart = hash.split('?')[0];
  const valid: Route[] = ['dashboard', 'editor', 'monitoring', 'settings'];
  return valid.includes(routePart as Route) ? (routePart as Route) : 'dashboard';
}

export function useRouter(): {
  route: Route;
  navigate: (route: Route, queryParams?: Record<string, string>) => void;
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

  const navigate = useCallback((newRoute: Route, queryParams?: Record<string, string>) => {
    console.log('Router navigate called:', { newRoute, queryParams });
    if (queryParams && Object.keys(queryParams).length > 0) {
      const params = new URLSearchParams(queryParams);
      const newHash = `#/${newRoute}?${params.toString()}`;
      console.log('Setting hash to:', newHash);
      window.location.hash = newHash;
      console.log('Hash after setting:', window.location.hash);
    } else {
      console.log('Setting hash to:', `#/${newRoute}`);
      window.location.hash = `#/${newRoute}`;
      console.log('Hash after setting:', window.location.hash);
    }
  }, []);

  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');

  return { route, navigate, params };
}
