import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RevisionHydrator } from '../RevisionHydrator';

vi.mock('../../api', () => ({
  conversationV2Api: {
    getAppSourceUrls: vi.fn(),
  },
}));

vi.mock('../../utils/app-source', () => ({
  isTextSourcePath: (path: string) => /\.(tsx?|jsx?|json|md|css|html|svg|txt)$/i.test(path),
}));

vi.mock('../../utils/files-tree', () => ({
  flattenFilesTree: (tree: unknown) => {
    const entries: Array<{ path: string }> = [];
    const walk = (node: Record<string, unknown>, prefix = '') => {
      if (node.type === 'file') {
        entries.push({ path: `${prefix}${node.name}` });
      }
      if (node.children && Array.isArray(node.children)) {
        for (const child of node.children as Record<string, unknown>[]) {
          walk(child, `${prefix}${node.name}/`);
        }
      }
    };
    walk(tree as Record<string, unknown>);
    return entries;
  },
}));

describe('RevisionHydrator', () => {
  let hydrator: RevisionHydrator;

  beforeEach(() => {
    vi.clearAllMocks();
    hydrator = new RevisionHydrator();
  });

  it('hydrateStarter returns bundled Vite/React starter files', () => {
    const files = hydrator.hydrateStarter();

    expect(files['/package.json']).toContain('yellowmind-starter');
    expect(files['/index.html']).toContain('<div id="root"></div>');
    expect(files['/vite.config.js']).toContain('defineConfig');
    expect(files['/src/main.jsx']).toContain('ReactDOM');
    expect(files['/src/App.jsx']).toContain('YellowMind Starter');
    expect(Object.keys(files)).toHaveLength(5);
  });

  it('hydrateFromCeph downloads files from presigned URLs', async () => {
    const { conversationV2Api } = await import('../../api');
    (conversationV2Api.getAppSourceUrls as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [
        { path: 'package.json', url: 'https://ceph/package.json' },
        { path: 'src/App.tsx', url: 'https://ceph/src/App.tsx' },
      ],
    });

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('package.json')) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('{"name": "test"}'),
        });
      }
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve('export default function App() {}'),
      });
    });

    const tree = {
      name: '',
      type: 'directory',
      children: [
        { name: 'package.json', type: 'file' },
        {
          name: 'src',
          type: 'directory',
          children: [{ name: 'App.tsx', type: 'file' }],
        },
      ],
    };

    const files = await hydrator.hydrateFromCeph('sess_1', '/ceph/path', tree as never);

    expect(files['/package.json']).toBe('{"name": "test"}');
    expect(files['/src/App.tsx']).toBe('export default function App() {}');
    expect(Object.keys(files)).toHaveLength(2);
  });

  it('hydrateFromCeph throws on empty tree', async () => {
    const tree = { name: '', type: 'directory', children: [] };
    await expect(
      hydrator.hydrateFromCeph('sess_1', '/path', tree as never),
    ).rejects.toThrow('No source files in tree');
  });

  it('syncToRevision writes files to pod', async () => {
    const mockFs = {
      writeFile: vi.fn().mockResolvedValue(undefined),
      mkdir: vi.fn().mockResolvedValue(undefined),
    };
    const pod = { fs: mockFs };

    await hydrator.syncToRevision(pod, {
      '/src/App.tsx': 'export default function App() {}',
      '/package.json': '{}',
    });

    expect(mockFs.mkdir).toHaveBeenCalledWith('/src', { recursive: true });
    expect(mockFs.writeFile).toHaveBeenCalledTimes(2);
  });
});
