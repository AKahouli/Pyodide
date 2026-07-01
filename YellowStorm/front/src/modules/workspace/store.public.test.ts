import { describe, it, expect, beforeEach, vi } from 'vitest';

const workspaceApiMock = vi.hoisted(() => ({
  getPublicWorkspaces: vi.fn(),
  setVisibility: vi.fn(),
}));

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('./api', () => workspaceApiMock);
vi.mock('sonner', () => ({ toast: toastMock }));

import { useWorkspaceStore, setWorkspaceTranslator } from './store';
import type { PublicWorkspaceResponse, Workspace } from './types';

const pub: PublicWorkspaceResponse = {
  id: 'p1', name: 'Pub', alias: 'pub', storagePrefix: 'pub',
  owner: { id: 'o1', email: 'o@x.io' },
  documentCount: 0, usedStorage: 0, allocatedStorage: 100,
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
};

describe('workspace store — public slice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setWorkspaceTranslator();
    useWorkspaceStore.setState({ publicWorkspaces: new Map(), publicCurrentPage: 1 });
  });

  it('fetchPublicWorkspaces caches the page', async () => {
    workspaceApiMock.getPublicWorkspaces.mockResolvedValue({
      workspaces: [pub], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    await useWorkspaceStore.getState().fetchPublicWorkspaces(1);
    expect(useWorkspaceStore.getState().publicWorkspaces.get(1)).toEqual([pub]);
    expect(useWorkspaceStore.getState().totalPublicWorkspaces).toBe(1);
  });

  it('setWorkspaceVisibility calls api and updates the workspace in cache', async () => {
    const ws: Workspace = {
      id: 'w1', name: 'W', alias: 'w', createdBy: 'me',
      documentCount: 0, usedStorage: 0, allocatedStorage: 100,
      isSystem: false, isPersonal: false, shareCount: 0, isPublic: false,
      createdAt: '2026-01-01', updatedAt: '2026-01-01',
    };
    useWorkspaceStore.setState({ workspaces: new Map([[1, [ws]]]), currentPage: 1 });
    workspaceApiMock.setVisibility.mockResolvedValue({ ...ws, isPublic: true });

    await useWorkspaceStore.getState().setWorkspaceVisibility('w1', true);

    expect(workspaceApiMock.setVisibility).toHaveBeenCalledWith('w1', true);
    const cached = useWorkspaceStore.getState().workspaces.get(1)!.find((w) => w.id === 'w1');
    expect(cached!.isPublic).toBe(true);
  });

  it('setWorkspaceVisibility surfaces the error and re-throws when the API call fails', async () => {
    const ws: Workspace = {
      id: 'w1', name: 'W', alias: 'w', createdBy: 'me',
      documentCount: 0, usedStorage: 0, allocatedStorage: 100,
      isSystem: false, isPersonal: false, shareCount: 0, isPublic: false,
      createdAt: '2026-01-01', updatedAt: '2026-01-01',
    };
    useWorkspaceStore.setState({ workspaces: new Map([[1, [ws]]]), currentPage: 1 });
    workspaceApiMock.setVisibility.mockRejectedValue(new Error('boom'));

    await expect(useWorkspaceStore.getState().setWorkspaceVisibility('w1', true)).rejects.toThrow('boom');

    expect(toastMock.error).toHaveBeenCalled();
    expect(useWorkspaceStore.getState().error).toBeTruthy();
  });
});
