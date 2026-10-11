import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loaded = vi.hoisted(() => ({ count: 0 }));
vi.mock('./OpenUiRenderer', () => { loaded.count += 1; return { default: () => null }; });

describe('OpenUI chunk preload', () => {
  beforeEach(() => {
    vi.resetModules();
    loaded.count = 0;
    vi.stubEnv('VITE_OPENUI_RENDER_ENABLED', 'true');
  });
  afterEach(() => vi.unstubAllEnvs());

  it('loads the renderer for an openui- agent, once, and shares the promise with lazy()', async () => {
    const { preloadOpenUiForAgent, loadOpenUiRenderer } = await import('./preload');
    preloadOpenUiForAgent({ slug: 'openui-experiment' });
    preloadOpenUiForAgent({ slug: 'openui-experiment' });
    await loadOpenUiRenderer();
    expect(loaded.count).toBe(1);
  });

  it('does nothing for other agents, a missing agent or a disabled build', async () => {
    const { preloadOpenUiForAgent } = await import('./preload');
    preloadOpenUiForAgent({ slug: 'research-assistant' });
    preloadOpenUiForAgent(undefined);
    vi.stubEnv('VITE_OPENUI_RENDER_ENABLED', 'false');
    preloadOpenUiForAgent({ slug: 'openui-experiment' });
    await Promise.resolve();
    expect(loaded.count).toBe(0);
  });
});
