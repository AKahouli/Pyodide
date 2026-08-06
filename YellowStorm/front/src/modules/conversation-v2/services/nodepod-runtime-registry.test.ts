import { describe, expect, it } from 'vitest';
import { NodepodRuntimeRegistry, createRuntimeKey } from './nodepod-runtime-registry';

describe('NodepodRuntimeRegistry', () => {
  it('stores and snapshots runtimes by runtime key', () => {
    const registry = new NodepodRuntimeRegistry();
    const runtimeKey = createRuntimeKey('session-a', 'rev-1');

    registry.set({
      runtimeKey,
      sessionId: 'session-a',
      revision: 'rev-1',
      pod: null,
      podInstanceId: 'pod-1',
      previewUrl: 'https://example.test/__virtual__/pod-1/3000',
      detectedPort: 3000,
      status: 'ready',
      files: { '/package.json': '{"name":"demo"}' },
      createdAt: 1,
      lastAccessedAt: 2,
      lastHealthcheckAt: 3,
      health: {
        directProbeOk: true,
        swProbeOk: true,
        detectedPort: 3000,
        previewUrl: 'https://example.test/__virtual__/pod-1/3000',
        lastCheckedAt: 3,
        bodyHint: null,
        lastStatus: 200,
      },
      bootPromise: null,
      error: null,
    });

    const snapshot = registry.getSnapshot(runtimeKey);
    expect(snapshot?.runtimeKey).toBe(runtimeKey);
    expect(snapshot?.detectedPort).toBe(3000);
    expect(snapshot?.files).toEqual({ '/package.json': '{"name":"demo"}' });
    // Stable reference for useSyncExternalStore
    expect(registry.getSnapshot(runtimeKey)).toBe(snapshot);
  });

  it('touch does not change the cached snapshot reference', () => {
    const registry = new NodepodRuntimeRegistry();
    const runtimeKey = createRuntimeKey('session-b', 'rev-1');
    registry.set({
      runtimeKey,
      sessionId: 'session-b',
      revision: 'rev-1',
      pod: null,
      podInstanceId: null,
      previewUrl: null,
      detectedPort: null,
      status: 'queued',
      files: null,
      createdAt: 1,
      lastAccessedAt: 1,
      lastHealthcheckAt: null,
      health: null,
      bootPromise: null,
      error: null,
    });
    const before = registry.getSnapshot(runtimeKey);
    registry.touch(runtimeKey, 99);
    expect(registry.getSnapshot(runtimeKey)).toBe(before);
    expect(registry.getMutable(runtimeKey)?.lastAccessedAt).toBe(99);
  });
});
