vi.mock('./artifact-api', () => ({}));
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from './store';

const api = vi.hoisted(() => ({ getWorkspaceUploadSettings: vi.fn(), initiateBulkUpload: vi.fn(), uploadToAzure: vi.fn(), completeBulkUpload: vi.fn(), uploadSmallFile: vi.fn() }));
const page = vi.hoisted(() => ({ listFolders: vi.fn(), createFolder: vi.fn(), assignFileToFolder: vi.fn() }));
vi.mock('./api', () => api);
vi.mock('./page-api', () => page);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));

function file(name: string, path?: string) {
  const result = new File(['data'], name, { type: 'application/pdf' });
  if (path) Object.defineProperty(result, 'webkitRelativePath', { value: path });
  return result;
}

describe('workspace page upload batches', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
    useWorkspaceStore.setState({ selectedWorkspaceId: 'workspace', pageCurrentFolderId: 'destination', refreshPageData: vi.fn(), refreshWorkspace: vi.fn(), fetchDocuments: vi.fn(), fetchAllFolders: vi.fn() });
    api.getWorkspaceUploadSettings.mockResolvedValue({ maxFileSizeMb: 1 });
    page.listFolders.mockResolvedValue([]);
    page.assignFileToFolder.mockResolvedValue({});
    api.uploadSmallFile.mockResolvedValue({ id: 'single' });
    let session = 0;
    api.initiateBulkUpload.mockImplementation(async (_id, request) => ({ sessionId: `session-${++session}`, files: request.files.map((f: { filename: string }, index: number) => ({ index, filename: f.filename, documentId: `${session}-${index}`, uploadUrl: 'https://upload' })) }));
    api.uploadToAzure.mockResolvedValue(undefined);
    api.completeBulkUpload.mockResolvedValue({ successful: { count: 50, documents: [] }, failed: { count: 0, files: [] } });
  });

  it('uploads hundreds sequentially in sessions of at most 50 with bounded PUT concurrency', async () => {
    let active = 0;
    let peak = 0;
    api.uploadToAzure.mockImplementation(async () => { active++; peak = Math.max(peak, active); await Promise.resolve(); active--; });
    await useWorkspaceStore.getState().uploadPageFiles(Array.from({ length: 101 }, (_, i) => file(`${i}.pdf`)));
    expect(api.initiateBulkUpload.mock.calls.map((call) => call[1].files.length)).toEqual([50, 50]);
    expect(api.uploadSmallFile).toHaveBeenCalledTimes(1);
    expect(peak).toBeLessThanOrEqual(4);
    expect(useWorkspaceStore.getState().uploadQueue).toHaveLength(101);
    expect(useWorkspaceStore.getState().uploadQueue.every((q) => q.status === 'completed' && q.documentId)).toBe(true);
    expect(page.assignFileToFolder).toHaveBeenCalledTimes(101);
  });

  it('retains a failed batch and continues uploading later batches', async () => {
    api.completeBulkUpload.mockRejectedValueOnce(new Error('finalization offline'));
    await useWorkspaceStore.getState().uploadPageFiles(Array.from({ length: 51 }, (_, i) => file(`${i}.pdf`)));
    const queue = useWorkspaceStore.getState().uploadQueue;
    expect(queue.filter((q) => q.status === 'failed')).toHaveLength(50);
    expect(queue.filter((q) => q.status === 'completed')).toHaveLength(1);
    expect(queue[0].error).toBe('finalization offline');
  });

  it('keeps completed identities until classifier assignment finishes despite dismissal', async () => {
    let releaseRefresh!: () => void;
    const refresh = vi.fn().mockResolvedValue(undefined).mockImplementationOnce(() => new Promise<void>((resolve) => { releaseRefresh = resolve; }));
    useWorkspaceStore.setState({ refreshWorkspace: refresh });
    const task = useWorkspaceStore.getState().uploadPageFiles([file('a.pdf'), file('b.pdf')]);
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(useWorkspaceStore.getState().uploadQueue.every((q) => q.status === 'completed')).toBe(true);
    useWorkspaceStore.getState().clearCompletedUploads();
    expect(useWorkspaceStore.getState().uploadQueue).toHaveLength(2);
    releaseRefresh();
    await task;
    expect(page.assignFileToFolder).toHaveBeenCalledTimes(2);
    expect(page.assignFileToFolder.mock.calls.every((call) => call[0] === 'workspace' && call[2] === 'destination')).toBe(true);
    useWorkspaceStore.getState().clearCompletedUploads();
    expect(useWorkspaceStore.getState().uploadQueue).toHaveLength(0);
  });

  it('publishes no pending files when preparing a later folder fails', async () => {
    page.createFolder.mockRejectedValueOnce(new Error('folder creation offline'));
    await useWorkspaceStore.getState().uploadPageFiles([file('root.pdf'), file('nested.pdf', 'Reports/nested.pdf')]);
    expect(useWorkspaceStore.getState().uploadQueue).toHaveLength(0);
    expect(api.uploadSmallFile).not.toHaveBeenCalled();
    expect(api.initiateBulkUpload).not.toHaveBeenCalled();
    await useWorkspaceStore.getState().uploadPageFiles([file('later.pdf')]);
    expect(api.uploadSmallFile).toHaveBeenCalledTimes(1);
    expect(page.assignFileToFolder).toHaveBeenCalledWith('workspace', 'single', 'destination');
  });

  it('preserves nested folder paths and captured destination when navigation changes', async () => {
    let release!: (value: { maxFileSizeMb: number }) => void;
    api.getWorkspaceUploadSettings.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    page.createFolder.mockImplementation(async (_id, input) => ({ id: input.name, parentId: input.parentId, name: input.name }));
    const task = useWorkspaceStore.getState().uploadPageFiles([file('a.pdf', 'Reports/2026/a.pdf')]);
    useWorkspaceStore.setState({ selectedWorkspaceId: 'elsewhere', pageCurrentFolderId: 'different' });
    release({ maxFileSizeMb: 1 });
    await task;
    expect(page.createFolder).toHaveBeenNthCalledWith(1, 'workspace', { name: 'Reports', description: 'Reports', parentId: 'destination' });
    expect(page.createFolder).toHaveBeenNthCalledWith(2, 'workspace', { name: '2026', description: 'Reports/2026', parentId: 'Reports' });
    expect(page.assignFileToFolder).toHaveBeenCalledWith('workspace', 'single', '2026');
    expect(api.uploadSmallFile.mock.calls[0][4]).toBeUndefined();
  });

  it('retains failed assignments and retries without uploading a duplicate document', async () => {
    page.assignFileToFolder.mockRejectedValueOnce(new Error('assignment offline'));
    await useWorkspaceStore.getState().uploadPageFiles([file('a.pdf')]);
    const item = useWorkspaceStore.getState().uploadQueue[0];
    expect(item).toMatchObject({ status: 'failed', error: 'assignment offline', documentId: 'single', folderId: 'destination' });
    useWorkspaceStore.getState().clearCompletedUploads();
    expect(useWorkspaceStore.getState().uploadQueue).toHaveLength(1);
    await useWorkspaceStore.getState().retryPageUpload(item.id);
    expect(api.uploadSmallFile).toHaveBeenCalledTimes(1);
    expect(useWorkspaceStore.getState().uploadQueue[0].status).toBe('completed');
  });

  it('prevents overlapping page selections before upload settings resolve', async () => {
    let release!: (value: { maxFileSizeMb: number }) => void;
    api.getWorkspaceUploadSettings.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const first = useWorkspaceStore.getState().uploadPageFiles([file('a.pdf')]);
    await useWorkspaceStore.getState().uploadPageFiles([file('b.pdf')]);
    release({ maxFileSizeMb: 1 });
    await first;
    expect(api.getWorkspaceUploadSettings).toHaveBeenCalledTimes(1);
    expect(api.uploadSmallFile).toHaveBeenCalledTimes(1);
  });
});
