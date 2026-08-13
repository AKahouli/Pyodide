import { describe, it, expect, beforeEach } from 'vitest';
import { WorkspaceRevisionStore, type ShaManifest } from '../WorkspaceRevisionStore';

const manifest = (entries: Record<string, string>): ShaManifest =>
  new Map(Object.entries(entries));

const INITIAL = manifest({ 'package.json': 'aaa', 'src/App.tsx': 'bbb' });

describe('WorkspaceRevisionStore', () => {
  let store: WorkspaceRevisionStore;

  beforeEach(() => {
    store = new WorkspaceRevisionStore(INITIAL);
  });

  it('seeds at rev_1 when no id is supplied', () => {
    expect(store.latestRevisionId).toBe('rev_1');
    expect(store.parentOf('rev_1')).toBeNull();
  });

  it('mints monotonic ids on commit', () => {
    expect(store.commit(manifest({ 'package.json': 'aaa' }))).toBe('rev_2');
    expect(store.commit(manifest({ 'package.json': 'ccc' }))).toBe('rev_3');
    expect(store.latestRevisionId).toBe('rev_3');
    expect(store.parentOf('rev_3')).toBe('rev_2');
  });

  it('keeps snapshots isolated from later mutation of the source map', () => {
    const live = manifest({ 'a.ts': '111' });
    store.commit(live);
    live.set('a.ts', 'changed');
    expect(store.snapshot('rev_2')?.get('a.ts')).toBe('111');
  });

  it('seeds at a backend-supplied revision and stays ahead of it', () => {
    store.seed(INITIAL, 'rev_7');
    expect(store.latestRevisionId).toBe('rev_7');
    expect(store.commit(INITIAL)).toBe('rev_8');
  });

  it('accepts a non-numeric seed id without breaking minting', () => {
    store.seed(INITIAL, 'ceph-abc123');
    expect(store.latestRevisionId).toBe('ceph-abc123');
    expect(store.commit(INITIAL)).toBe('rev_2');
  });

  describe('diffAgainst', () => {
    it('reports modified, added and deleted files against an explicit base', () => {
      const current = manifest({ 'package.json': 'aaa', 'src/New.tsx': 'ddd' });
      const result = store.diffAgainst(current, 'rev_1');

      expect(result.revisionId).toBe('rev_1');
      expect(result.parentRevisionId).toBe('rev_1');
      expect(result.changedFiles).toEqual(['src/App.tsx', 'src/New.tsx']);
      expect(result.diff).toContain('- src/App.tsx (deleted)');
      expect(result.diff).toContain('+++ b/src/New.tsx');
      expect(result.diff).toContain('@@ SHA-256: (none) -> ddd @@');
    });

    it('returns "(no changes)" when nothing moved', () => {
      const result = store.diffAgainst(INITIAL, 'rev_1');
      expect(result.changedFiles).toEqual([]);
      expect(result.diff).toBe('(no changes)');
    });

    it('returns an empty result for an unknown base revision', () => {
      const result = store.diffAgainst(INITIAL, 'rev_999');
      expect(result).toEqual({
        revisionId: 'rev_1',
        parentRevisionId: null,
        diff: '',
        changedFiles: [],
      });
    });

    it('defaults the base to the parent of the latest revision', () => {
      store.commit(manifest({ 'package.json': 'aaa', 'src/App.tsx': 'ccc' }));
      const result = store.diffAgainst(
        manifest({ 'package.json': 'aaa', 'src/App.tsx': 'ccc' }),
      );
      expect(result.revisionId).toBe('rev_2');
      expect(result.parentRevisionId).toBeNull();
      expect(result.changedFiles).toEqual(['src/App.tsx']);
    });

    it('scopes the comparison to a single path', () => {
      const current = manifest({ 'package.json': 'zzz', 'src/App.tsx': 'yyy' });
      const result = store.diffAgainst(current, 'rev_1', 'src/App.tsx');
      expect(result.changedFiles).toEqual(['src/App.tsx']);
    });
  });
});
