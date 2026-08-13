import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RevisionHydrator } from '../RevisionHydrator';

vi.mock('../../api', () => ({
  conversationV2Api: {
    getAppSourceUrls: vi.fn(),
    getRevisionFiles: vi.fn(),
    presignRevisionFiles: vi.fn(),
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
    expect(files['/src/App.css']).toContain('font-family');
    expect(Object.keys(files)).toHaveLength(6);
  });

  it('hydrateFromRevision lists files, presigns, and downloads blobs', async () => {
    const { conversationV2Api } = await import('../../api');
    (conversationV2Api.getRevisionFiles as ReturnType<typeof vi.fn>).mockResolvedValue({
      revisionId: 'starter_react_vite_v1',
      files: [
        { path: 'package.json', sha256: 'a', size: 10 },
        { path: 'src/App.jsx', sha256: 'b', size: 20 },
      ],
    });
    (conversationV2Api.presignRevisionFiles as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [
        { path: 'package.json', url: 'https://ceph/package.json' },
        { path: 'src/App.jsx', url: 'https://ceph/src/App.jsx' },
      ],
    });

    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('package.json')) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve('{"name":"from-ceph"}'),
        });
      }
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve('export default function App() { return null; }'),
      });
    });

    const files = await hydrator.hydrateFromRevision('sess_1', 'starter_react_vite_v1');

    expect(conversationV2Api.getRevisionFiles).toHaveBeenCalledWith(
      'sess_1',
      'starter_react_vite_v1',
    );
    expect(conversationV2Api.presignRevisionFiles).toHaveBeenCalledWith(
      'sess_1',
      'starter_react_vite_v1',
      ['package.json', 'src/App.jsx'],
    );
    expect(files['/package.json']).toBe('{"name":"from-ceph"}');
    expect(files['/src/App.jsx']).toContain('export default function App');
  });

  it('hydrateFromRevision throws when the revision has no files', async () => {
    const { conversationV2Api } = await import('../../api');
    (conversationV2Api.getRevisionFiles as ReturnType<typeof vi.fn>).mockResolvedValue({
      revisionId: 'empty',
      files: [],
    });

    await expect(hydrator.hydrateFromRevision('sess_1', 'empty')).rejects.toThrow(
      'Revision empty has no files',
    );
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
