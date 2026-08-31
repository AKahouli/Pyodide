import { describe, expect, it } from 'vitest';
import {
  countFilesInTree,
  filterFilesTree,
  flattenFilesTree,
  restoreMangledDotfilePath,
  buildFilesTreeFromVfsPaths,
  normalizeFilesTree,
  resolveSourceFilesTree,
} from './files-tree';

describe('restoreMangledDotfilePath', () => {
  it('restores a leading dot on known mangled basenames', () => {
    expect(restoreMangledDotfilePath('gitignore')).toBe('.gitignore');
    expect(restoreMangledDotfilePath('env.local')).toBe('.env.local');
    expect(restoreMangledDotfilePath('app/eslintrc.json')).toBe('app/.eslintrc.json');
  });

  it('leaves already-correct and unrelated paths alone', () => {
    expect(restoreMangledDotfilePath('.gitignore')).toBe('.gitignore');
    expect(restoreMangledDotfilePath('package.json')).toBe('package.json');
    expect(restoreMangledDotfilePath('app/page.tsx')).toBe('app/page.tsx');
  });
});

describe('flattenFilesTree', () => {
  it('collects file paths from a nested tree', () => {
    const flat = flattenFilesTree({
      name: '',
      type: 'directory',
      children: [
        {
          name: 'app',
          type: 'directory',
          children: [
            { name: 'page.tsx', type: 'file', path: 'app/page.tsx', size: 10 },
          ],
        },
        { name: 'package.json', type: 'file', path: 'package.json', size: 20 },
      ],
    });
    expect(flat).toEqual([
      { path: 'app/page.tsx', size: 10 },
      { path: 'package.json', size: 20 },
    ]);
  });

  it('restores mangled dotfile paths from Manus trees', () => {
    const flat = flattenFilesTree({
      name: '',
      type: 'directory',
      children: [{ name: 'gitignore', type: 'file', path: 'gitignore', size: 5 }],
    });
    expect(flat).toEqual([{ path: '.gitignore', size: 5 }]);
  });

  it('returns an empty list for null/undefined', () => {
    expect(flattenFilesTree(null)).toEqual([]);
    expect(flattenFilesTree(undefined)).toEqual([]);
  });
});

describe('countFilesInTree', () => {
  it('counts file nodes', () => {
    expect(
      countFilesInTree({
        name: '',
        type: 'directory',
        children: [
          { name: 'a.ts', type: 'file', path: 'a.ts' },
          { name: 'b.ts', type: 'file', path: 'b.ts' },
        ],
      }),
    ).toBe(2);
  });
});

describe('filterFilesTree', () => {
  const tree = {
    name: '',
    type: 'directory' as const,
    children: [
      {
        name: 'src',
        type: 'directory' as const,
        children: [
          { name: 'App.tsx', type: 'file' as const, path: 'src/App.tsx' },
          { name: 'main.tsx', type: 'file' as const, path: 'src/main.tsx' },
        ],
      },
      { name: 'package.json', type: 'file' as const, path: 'package.json' },
    ],
  };

  it('returns the full tree when query is empty', () => {
    expect(filterFilesTree(tree, '')).toEqual(tree);
  });

  it('keeps matching files and ancestor folders', () => {
    const filtered = filterFilesTree(tree, 'app');
    expect(filtered?.children?.[0]?.name).toBe('src');
    expect(filtered?.children?.[0]?.children).toEqual([
      { name: 'App.tsx', type: 'file', path: 'src/App.tsx' },
    ]);
  });

  it('returns null when nothing matches', () => {
    expect(filterFilesTree(tree, 'zzznomatch')).toBeNull();
  });
});

describe('buildFilesTreeFromVfsPaths', () => {
  it('adds relative paths on file nodes', () => {
    const tree = buildFilesTreeFromVfsPaths(['/src/App.jsx', '/package.json']);
    expect(countFilesInTree(tree)).toBe(2);
    expect(flattenFilesTree(tree).map((f) => f.path)).toEqual(['package.json', 'src/App.jsx']);
  });
});

describe('normalizeFilesTree', () => {
  it('converts legacy runtime trees with dir nodes and no paths', () => {
    const tree = normalizeFilesTree({
      name: '/',
      type: 'dir',
      children: [
        { name: 'package.json', type: 'file' },
        {
          name: 'src',
          type: 'dir',
          children: [{ name: 'App.jsx', type: 'file' }],
        },
      ],
    });
    expect(flattenFilesTree(tree)).toEqual([
      { path: 'package.json', size: 0 },
      { path: 'src/App.jsx', size: 0 },
    ]);
  });
});

describe('resolveSourceFilesTree', () => {
  it('prefers live Nodepod VFS over SSE metadata', () => {
    const tree = resolveSourceFilesTree(
      {
        name: '',
        type: 'directory',
        children: [{ name: 'old.tsx', type: 'file', path: 'old.tsx' }],
      },
      {
        '/src/App.jsx': 'export default function App() {}',
        '/package.json': '{}',
      },
    );
    expect(flattenFilesTree(tree).map((f) => f.path)).toEqual(['package.json', 'src/App.jsx']);
  });

  it('falls back to SSE metadata when VFS is empty', () => {
    const tree = resolveSourceFilesTree(
      {
        name: '',
        type: 'directory',
        children: [{ name: 'App.jsx', type: 'file', path: 'src/App.jsx' }],
      },
      null,
    );
    expect(countFilesInTree(tree)).toBe(1);
  });
});
