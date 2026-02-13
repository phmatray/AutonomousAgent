import { assign, setup } from 'xstate';

export type Route =
  | 'dashboard'
  | 'backlog'
  | 'editor'
  | 'monitoring'
  | 'credentials'
  | 'settings';

interface RouterContext {
  hash: string;
}

type RouterEvent =
  | { type: 'HASH_CHANGED'; hash: string }
  | { type: 'NAVIGATE'; route: Route; queryParams?: Record<string, string> };

const validRoutes: Route[] = [
  'dashboard',
  'backlog',
  'editor',
  'monitoring',
  'credentials',
  'settings',
];

export function getRouteFromHash(hashValue: string): Route {
  const hash = hashValue.replace('#/', '').replace('#', '');
  const routePart = hash.split('?')[0];
  return validRoutes.includes(routePart as Route) ? (routePart as Route) : 'dashboard';
}

export function getParamsFromHash(hashValue: string): URLSearchParams {
  return new URLSearchParams(hashValue.split('?')[1] ?? '');
}

function buildHash(route: Route, queryParams?: Record<string, string>): string {
  if (queryParams && Object.keys(queryParams).length > 0) {
    const params = new URLSearchParams(queryParams);
    return `#/${route}?${params.toString()}`;
  }
  return `#/${route}`;
}

export const routerMachine = setup({
  types: {} as {
    context: RouterContext;
    events: RouterEvent;
  },
}).createMachine({
  id: 'router',
  context: {
    hash: window.location.hash,
  },
  initial: 'ready',
  states: {
    ready: {
      on: {
        HASH_CHANGED: {
          actions: assign({
            hash: ({ event }) => event.hash,
          }),
        },
        NAVIGATE: {
          actions: [
            assign({
              hash: ({ event, context }) =>
                event.type === 'NAVIGATE'
                  ? buildHash(event.route, event.queryParams)
                  : context.hash,
            }),
            ({ event }) => {
              if (event.type !== 'NAVIGATE') return;
              const nextHash = buildHash(event.route, event.queryParams);
              if (window.location.hash !== nextHash) {
                window.location.hash = nextHash;
              }
            },
          ],
        },
      },
    },
  },
});
