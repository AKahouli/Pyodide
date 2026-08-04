import { describe, expect, it } from 'vitest';
import { flattenFilesTree, restoreMangledDotfilePath } from './files-tree';

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
