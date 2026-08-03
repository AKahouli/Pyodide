import { describe, expect, it } from 'vitest';
import { flattenFilesTree } from './files-tree';

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

  it('returns an empty list for null/undefined', () => {
    expect(flattenFilesTree(null)).toEqual([]);
    expect(flattenFilesTree(undefined)).toEqual([]);
  });
});
