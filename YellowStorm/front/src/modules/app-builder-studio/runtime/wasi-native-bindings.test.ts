import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  ensureDebugWasmAlias,
  ensureWasiNativeBindings,
  isFatalWasiToolchainError,
  type WasiFs,
  type WasiPod,
} from './wasi-native-bindings';

describe('isFatalWasiToolchainError', () => {
  it('detects NodePod CDN 404s for debug.wasm', () => {
    expect(
      isFatalWasiToolchainError(
        'GET https://cdn.jsdelivr.net/npm/@rolldown/binding-wasm32-wasi@1.2.11/rolldown-binding.wasm32-wasi.debug.wasm 404 (Not Found)',
      ),
    ).toBe(true);
  });

  it('detects lightningcss wasm-fallback ENOENT', () => {
    expect(
      isFatalWasiToolchainError(
        "[wasm-fallback] lightningcss-wasm: ENOENT: no such file or directory, open '/lightningcss-wasm/lightningcss_node.wasm'",
      ),
    ).toBe(true);
  });

  it('ignores unrelated stderr', () => {
    expect(isFatalWasiToolchainError('Browserslist: caniuse-lite is outdated')).toBe(false);
  });
});

describe('ensureDebugWasmAlias', () => {
  it('copies release wasm to the debug name NodePod requests', async () => {
    const store = new Map<string, Uint8Array | string>();
    store.set('/pkg/rel.wasm', new Uint8Array([1, 2, 3]));
    const fs: WasiFs = {
      exists: async (p) => store.has(p),
      readFile: async (p) => store.get(p)!,
      writeFile: async (p, c) => {
        store.set(p, typeof c === 'string' ? c : c);
      },
    };

    await expect(
      ensureDebugWasmAlias(fs, '/pkg', 'rel.wasm', 'rel.debug.wasm'),
    ).resolves.toBe(true);
    expect(store.get('/pkg/rel.debug.wasm')).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('is a no-op when debug already exists', async () => {
    const writeFile = vi.fn();
    const fs: WasiFs = {
      exists: async (p) => p.endsWith('debug.wasm') || p.endsWith('rel.wasm'),
      readFile: async () => new Uint8Array([9]),
      writeFile,
    };
    await expect(
      ensureDebugWasmAlias(fs, '/pkg', 'rel.wasm', 'rel.debug.wasm'),
    ).resolves.toBe(true);
    expect(writeFile).not.toHaveBeenCalled();
  });
});

describe('ensureWasiNativeBindings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('installs missing wasm packages and aliases debug.wasm', async () => {
    const store = new Map<string, Uint8Array | string>();
    store.set('/node_modules/rolldown', 'dir');
    store.set(
      '/node_modules/rolldown/package.json',
      JSON.stringify({ version: '1.2.11' }),
    );
    store.set('/node_modules/lightningcss', 'dir');
    store.set(
      '/node_modules/lightningcss/package.json',
      JSON.stringify({ version: '1.30.0' }),
    );

    const spawn = vi.fn(async (_cmd: string, args: string[]) => {
      const spec = args[1] ?? '';
      if (spec.startsWith('@rolldown/binding-wasm32-wasi')) {
        store.set('/node_modules/@rolldown/binding-wasm32-wasi', 'dir');
        store.set(
          '/node_modules/@rolldown/binding-wasm32-wasi/rolldown-binding.wasm32-wasi.wasm',
          new Uint8Array([7]),
        );
      }
      if (spec.startsWith('lightningcss-wasm')) {
        store.set('/node_modules/lightningcss-wasm', 'dir');
        store.set(
          '/node_modules/lightningcss-wasm/lightningcss_node.wasm',
          new Uint8Array([8]),
        );
      }
      return {
        on: () => undefined,
        completion: Promise.resolve({ exitCode: 0, stdout: '' }),
      };
    });

    const pod: WasiPod = {
      fs: {
        exists: async (p) => store.has(p),
        readFile: async (p) => store.get(p)!,
        writeFile: async (p, c) => {
          store.set(p, c);
        },
      },
      spawn,
    };

    const result = await ensureWasiNativeBindings(pod);
    expect(result.prepared).toEqual(
      expect.arrayContaining([
        '/node_modules/@rolldown/binding-wasm32-wasi',
        '/node_modules/lightningcss-wasm',
      ]),
    );
    expect(result.failed).toEqual([]);
    expect(spawn).toHaveBeenCalledWith(
      'npm',
      expect.arrayContaining(['@rolldown/binding-wasm32-wasi@1.2.11']),
    );
    expect(
      store.has(
        '/node_modules/@rolldown/binding-wasm32-wasi/rolldown-binding.wasm32-wasi.debug.wasm',
      ),
    ).toBe(true);
  });

  it('skips bindings when native packages are absent', async () => {
    const pod: WasiPod = {
      fs: {
        exists: async () => false,
        readFile: async () => {
          throw new Error('missing');
        },
        writeFile: async () => undefined,
      },
      spawn: vi.fn(),
    };
    const result = await ensureWasiNativeBindings(pod);
    expect(result.prepared).toEqual([]);
    expect(pod.spawn).not.toHaveBeenCalled();
  });
});
