import { createActor } from 'xstate';
import { beforeEach, describe, expect, it } from 'vitest';
import { getParamsFromHash, getRouteFromHash, routerMachine } from './router-machine';

describe('router-machine helpers', () => {
  it('extracts a valid route from hash and falls back to dashboard', () => {
    expect(getRouteFromHash('#/editor')).toBe('editor');
    expect(getRouteFromHash('#/monitoring?tab=failed')).toBe('monitoring');
    expect(getRouteFromHash('#/credentials')).toBe('credentials');
    expect(getRouteFromHash('#/unknown')).toBe('dashboard');
  });

  it('extracts query params from hash', () => {
    const params = getParamsFromHash('#/editor?workflow=42&mode=debug');
    expect(params.get('workflow')).toBe('42');
    expect(params.get('mode')).toBe('debug');
  });
});

describe('routerMachine', () => {
  beforeEach(() => {
    window.location.hash = '#/dashboard';
  });

  it('updates context hash on HASH_CHANGED', () => {
    const actor = createActor(routerMachine).start();

    actor.send({ type: 'HASH_CHANGED', hash: '#/backlog' });

    expect(actor.getSnapshot().context.hash).toBe('#/backlog');
  });

  it('builds and applies hash with query params on NAVIGATE', () => {
    const actor = createActor(routerMachine).start();

    actor.send({
      type: 'NAVIGATE',
      route: 'editor',
      queryParams: { workflow: '42', mode: 'debug' },
    });

    const hash = actor.getSnapshot().context.hash;
    expect(hash.startsWith('#/editor?')).toBe(true);

    const params = new URLSearchParams(hash.split('?')[1] ?? '');
    expect(params.get('workflow')).toBe('42');
    expect(params.get('mode')).toBe('debug');
    expect(window.location.hash).toBe(hash);
  });

  it('keeps simple hash format when navigating without query params', () => {
    const actor = createActor(routerMachine).start();

    actor.send({ type: 'NAVIGATE', route: 'backlog' });

    expect(actor.getSnapshot().context.hash).toBe('#/backlog');
    expect(window.location.hash).toBe('#/backlog');
  });

  it('does not rewrite window hash when navigating to the same route', () => {
    window.location.hash = '#/settings';
    const actor = createActor(routerMachine).start();

    actor.send({ type: 'NAVIGATE', route: 'settings' });

    expect(actor.getSnapshot().context.hash).toBe('#/settings');
    expect(window.location.hash).toBe('#/settings');
  });
});
