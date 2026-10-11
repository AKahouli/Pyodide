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

  it('loads the renderer for a generative UI agent, once, and shares the promise with lazy()', async () => {
    const { preloadOpenUiForAgent, loadOpenUiRenderer } = await import('./preload');
    preloadOpenUiForAgent({ genUiEnabled: true });
    preloadOpenUiForAgent({ genUiEnabled: true });
    await loadOpenUiRenderer();
    expect(loaded.count).toBe(1);
  });

  it('does nothing for agents with generative UI off, a missing agent or a disabled build', async () => {
    const { preloadOpenUiForAgent } = await import('./preload');
    preloadOpenUiForAgent({ genUiEnabled: false });
    preloadOpenUiForAgent({});
    preloadOpenUiForAgent(undefined);
    vi.stubEnv('VITE_OPENUI_RENDER_ENABLED', 'false');
    preloadOpenUiForAgent({ genUiEnabled: true });
    await Promise.resolve();
    expect(loaded.count).toBe(0);
  });
});
