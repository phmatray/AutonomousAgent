import { useEffect, useCallback, useMemo, type ReactNode, createElement } from 'react';
import { createActorContext } from '@xstate/react';
import { routerMachine, getRouteFromHash, getParamsFromHash, type Route } from './router-machine';
export type { Route } from './router-machine';

const RouterMachineContext = createActorContext(routerMachine);

export function RouterProvider({ children }: { children: ReactNode }) {
  return createElement(RouterMachineContext.Provider, null, children);
}

export function useRouter(): {
  route: Route;
  navigate: (route: Route, queryParams?: Record<string, string>) => void;
  params: URLSearchParams;
} {
  const actorRef = RouterMachineContext.useActorRef();
  const hash = RouterMachineContext.useSelector((state) => state.context.hash);

  useEffect(() => {
    function onHashChange() {
      actorRef.send({ type: 'HASH_CHANGED', hash: window.location.hash });
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [actorRef]);

  const navigate = useCallback((newRoute: Route, queryParams?: Record<string, string>) => {
    actorRef.send({ type: 'NAVIGATE', route: newRoute, queryParams });
  }, [actorRef]);

  const route = useMemo(() => getRouteFromHash(hash), [hash]);
  const params = useMemo(() => getParamsFromHash(hash), [hash]);

  return { route, navigate, params };
}
