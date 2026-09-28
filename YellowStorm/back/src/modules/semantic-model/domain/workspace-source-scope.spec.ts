import { isWorkspaceMappingKey, mappingSelection, normalizeWorkspaceSelection, workspaceMappingFiles, workspaceMappingKey } from './workspace-source-scope';

const TYPES = new Set(['application/pdf']);
const item = (id: string, overrides: Record<string, unknown> = {}) =>
  ({ id, mimeType: 'application/pdf', isFolder: false, parentId: null as string | null, indexingStatus: 'ready', ...overrides });

describe('workspaceMappingFiles', () => {
  it('keeps readable documents in id order and sets aside those still being indexed', () => {
    const files = workspaceMappingFiles([item('b'), item('a'), item('c', { indexingStatus: 'pending' }), item('x', { mimeType: 'image/png' }), item('f', { isFolder: true })], TYPES);
    expect(files.readable.map((file) => file.id)).toEqual(['a', 'b']);
    expect(files.waiting.map((file) => file.id)).toEqual(['c']);
  });

  it('limits to a folder at any depth', () => {
    const all = [item('top', { isFolder: true }), item('sub', { isFolder: true, parentId: 'top' }),
      item('deep', { parentId: 'sub' }), item('near', { parentId: 'top' }), item('outside')];
    expect(workspaceMappingFiles(all, TYPES, 'top').readable.map((file) => file.id)).toEqual(['deep', 'near']);
    expect(workspaceMappingFiles(all, TYPES, 'sub').readable.map((file) => file.id)).toEqual(['deep']);
  });

  it('names a workspace source by workspace and folder', () => {
    expect(workspaceMappingKey('ws', null)).toBe('workspace:ws:all');
    expect(workspaceMappingKey('ws', 'f1')).toBe('workspace:ws:f1');
    expect(isWorkspaceMappingKey('workspace:ws:all')).toBe(true);
    expect(isWorkspaceMappingKey('6512f0a1c9e77a001234bbb1')).toBe(false);
  });
});

describe('picked folders and files', () => {
  const all = [item('top', { isFolder: true }), item('sub', { isFolder: true, parentId: 'top' }), item('other', { isFolder: true }),
    item('deep', { parentId: 'sub' }), item('near', { parentId: 'top' }), item('loose'), item('elsewhere', { parentId: 'other' }), item('single', { parentId: 'other' })];

  it('covers every file of the picked folders plus the picked files', () => {
    const selection = normalizeWorkspaceSelection(['sub'], ['single', 'loose']);
    expect(workspaceMappingFiles(all, TYPES, selection).readable.map((file) => file.id)).toEqual(['deep', 'loose', 'single']);
  });

  it('treats an empty pick as the whole workspace, and reads the folder older mappings kept', () => {
    expect(normalizeWorkspaceSelection([], [])).toBeNull();
    expect(mappingSelection({ folderId: 'top', selection: null })).toEqual({ folderIds: ['top'], documentIds: [] });
    expect(mappingSelection({ folderId: null, selection: { folderIds: ['b', 'a', 'a'], documentIds: [] } })).toEqual({ folderIds: ['a', 'b'], documentIds: [] });
  });

  it('gives the same key to the same pick in any order, and a readable key to a single folder', () => {
    const key = workspaceMappingKey('ws', normalizeWorkspaceSelection(['b', 'a'], ['d']));
    expect(key).toMatch(/^workspace:ws:pick-[0-9a-f]{16}$/);
    expect(workspaceMappingKey('ws', normalizeWorkspaceSelection(['a', 'b'], ['d', 'd']))).toBe(key);
    expect(workspaceMappingKey('ws', normalizeWorkspaceSelection(['f1'], []))).toBe('workspace:ws:f1');
    expect(workspaceMappingKey('ws', null)).toBe('workspace:ws:all');
  });
});
