import { describe, it, expect } from 'vitest';
import { groupBySourceRoot } from './source-groups';
import type { WorkspaceFile } from '../types';

function urlFile(id: string, over: Partial<WorkspaceFile> = {}): WorkspaceFile {
  return {
    id, workspaceId: 'w1', name: id, mimeType: 'application/pdf', size: 0, uploadedAt: null,
    folderId: null, assignmentSource: null, type: 'url',
    sourceRootUrl: 'https://ex.com/services', normalizedSourceRootUrl: 'https://ex.com/services',
    indexingStatus: 'ready', ...over,
  };
}

describe('groupBySourceRoot', () => {
  it('groups 2+ url-docs sharing a normalized root and cleans the label', () => {
    const { groups, loose } = groupBySourceRoot([urlFile('a'), urlFile('b')]);
    expect(loose).toHaveLength(0);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('https://ex.com/services');
    expect(groups[0].label).toBe('ex.com/services');
    expect(groups[0].files.map((f) => f.id)).toEqual(['a', 'b']);
  });

  it('keeps a lone url-doc loose (no group of one)', () => {
    const { groups, loose } = groupBySourceRoot([urlFile('a')]);
    expect(groups).toHaveLength(0);
    expect(loose.map((f) => f.id)).toEqual(['a']);
  });

  it('excludes non-url docs and docs without a normalized root', () => {
    const { groups, loose } = groupBySourceRoot([
      urlFile('a'), urlFile('b'),
      urlFile('c', { type: 'doc' }),
      urlFile('d', { normalizedSourceRootUrl: undefined }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].files.map((f) => f.id)).toEqual(['a', 'b']);
    expect(loose.map((f) => f.id)).toEqual(['c', 'd']);
  });

  it('preserves first-seen order of groups and loose files', () => {
    const other = { sourceRootUrl: 'https://z.io/docs', normalizedSourceRootUrl: 'https://z.io/docs' };
    const { groups, loose } = groupBySourceRoot([
      urlFile('single', { normalizedSourceRootUrl: 'https://solo.io/p' }),
      urlFile('a'), urlFile('z1', other), urlFile('b'), urlFile('z2', other),
    ]);
    expect(groups.map((g) => g.key)).toEqual(['https://ex.com/services', 'https://z.io/docs']);
    expect(loose.map((f) => f.id)).toEqual(['single']);
  });

  it('aggregates status: failed beats processing beats ready', () => {
    expect(groupBySourceRoot([urlFile('a'), urlFile('b', { indexingStatus: 'failed' })]).groups[0].status).toBe('failed');
    expect(groupBySourceRoot([urlFile('a'), urlFile('b', { indexingStatus: 'processing' })]).groups[0].status).toBe('processing');
    expect(groupBySourceRoot([urlFile('a'), urlFile('b')]).groups[0].status).toBe('ready');
  });

  it('groups by sourceGroupId, so two sessions on the same URL form separate groups', () => {
    const files = [
      urlFile('a', { sourceGroupId: 'g1', sourceRootUrl: 'https://ex.com', normalizedSourceRootUrl: 'https://ex.com' }),
      urlFile('b', { sourceGroupId: 'g1', sourceRootUrl: 'https://ex.com', normalizedSourceRootUrl: 'https://ex.com' }),
      urlFile('c', { sourceGroupId: 'g2', sourceRootUrl: 'https://ex.com', normalizedSourceRootUrl: 'https://ex.com' }),
      urlFile('d', { sourceGroupId: 'g2', sourceRootUrl: 'https://ex.com', normalizedSourceRootUrl: 'https://ex.com' }),
    ];
    const { groups } = groupBySourceRoot(files);
    expect(groups.map((g) => g.key)).toEqual(['g1', 'g2']); // same URL → two distinct groups
    expect(groups.every((g) => g.label === 'ex.com')).toBe(true);
    expect(groups[0].sourceGroupId).toBe('g1');
  });

  it('falls back to root-URL grouping for legacy docs without a sourceGroupId', () => {
    const files = [
      urlFile('a', { sourceRootUrl: 'https://ex.com', normalizedSourceRootUrl: 'https://ex.com' }),
      urlFile('b', { sourceRootUrl: 'https://ex.com', normalizedSourceRootUrl: 'https://ex.com' }),
    ];
    const { groups } = groupBySourceRoot(files);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe('https://ex.com');
  });
});
