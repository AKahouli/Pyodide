import { act, renderHook, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConversationFileUpload } from './useConversationFileUpload';

const requestFileUploadUrlMock = vi.hoisted(() => vi.fn());
const confirmFileUploadMock = vi.hoisted(() => vi.fn());
const deleteConversationFileMock = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  requestFileUploadUrl: requestFileUploadUrlMock,
  confirmFileUpload: confirmFileUploadMock,
  deleteConversationFile: deleteConversationFileMock,
}));

vi.mock('../translation', () => ({
  translateConversation: (key: string) => key,
}));

class MockXMLHttpRequest {
  static instances: MockXMLHttpRequest[] = [];

  static reset() {
    MockXMLHttpRequest.instances = [];
  }

  upload: { onprogress: ((event: ProgressEvent<EventTarget>) => void) | null } = {
    onprogress: null,
  };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  status = 200;
  aborted = false;

  constructor() {
    MockXMLHttpRequest.instances.push(this);
  }

  open() {}

  setRequestHeader() {}

  send() {}

  abort() {
    this.aborted = true;
    this.onabort?.();
  }

  emitProgress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent<EventTarget>);
  }

  emitLoad(status = 200) {
    this.status = status;
    this.onload?.();
  }
}

describe('useConversationFileUpload', () => {
  const originalXMLHttpRequest = globalThis.XMLHttpRequest;

  beforeAll(() => {
    globalThis.XMLHttpRequest = MockXMLHttpRequest as unknown as typeof XMLHttpRequest;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    MockXMLHttpRequest.reset();
    requestFileUploadUrlMock.mockResolvedValue({
      documentId: 'doc-1',
      uploadUrl: 'https://upload.example/file',
      expiresAt: new Date().toISOString(),
    });
    confirmFileUploadMock.mockResolvedValue({ id: 'doc-1' });
  });

  it('uploads and confirms a file', async () => {
    const createConversation = vi.fn().mockResolvedValue({ id: 'conv-1' });
    const onError = vi.fn();
    const file = new File(['hello'], 'hello.txt', { type: 'text/plain' });

    const { result } = renderHook(() =>
      useConversationFileUpload({
        conversationId: null,
        createConversation,
        onError,
      }),
    );

    act(() => {
      result.current.addFiles([file], ['local-1']);
    });

    await waitFor(() => {
      expect(createConversation).toHaveBeenCalledTimes(1);
      expect(requestFileUploadUrlMock).toHaveBeenCalledWith('conv-1', {
        filename: 'hello.txt',
        mimeType: 'text/plain',
        size: 5,
      });
    });

    const xhr = MockXMLHttpRequest.instances[0];
    expect(xhr).toBeDefined();

    act(() => {
      xhr.emitProgress(3, 5);
    });

    await waitFor(() => {
      expect(result.current.files[0]?.progress).toBe(60);
    });

    act(() => {
      xhr.emitLoad(201);
    });

    await waitFor(() => {
      expect(confirmFileUploadMock).toHaveBeenCalledWith('conv-1', 'doc-1');
      expect(result.current.files[0]?.status).toBe('completed');
      expect(result.current.completedFileIds).toEqual(['doc-1']);
      expect(result.current.isUploading).toBe(false);
      expect(result.current.conversationId).toBe('conv-1');
    });

    expect(onError).not.toHaveBeenCalled();
  });

  it('marks files as failed when conversation creation fails', async () => {
    const createConversation = vi.fn().mockRejectedValue(new Error('boom'));
    const file = new File(['abc'], 'note.txt', { type: 'text/plain' });

    const { result } = renderHook(() =>
      useConversationFileUpload({
        conversationId: null,
        createConversation,
      }),
    );

    act(() => {
      result.current.addFiles([file], ['local-fail']);
    });

    await waitFor(() => {
      expect(result.current.files[0]?.status).toBe('failed');
      expect(result.current.files[0]?.error).toBe('upload.errors.createConversation');
    });

    expect(requestFileUploadUrlMock).not.toHaveBeenCalled();
    expect(MockXMLHttpRequest.instances).toHaveLength(0);
  });

  it('aborts in-progress uploads when removing a file', async () => {
    const file = new File(['data'], 'keep.txt', { type: 'text/plain' });
    const { result } = renderHook(() =>
      useConversationFileUpload({
        conversationId: 'conv-1',
      }),
    );

    act(() => {
      result.current.addFiles([file], ['local-1']);
    });

    await waitFor(() => {
      expect(MockXMLHttpRequest.instances).toHaveLength(1);
    });

    const xhr = MockXMLHttpRequest.instances[0];

    await act(async () => {
      result.current.removeFile('local-1');
      await Promise.resolve();
    });

    expect(xhr.aborted).toBe(true);
    expect(result.current.files).toHaveLength(0);
    expect(deleteConversationFileMock).not.toHaveBeenCalled();
  });

  it('deletes backend file when removing a completed upload', async () => {
    const file = new File(['done'], 'done.txt', { type: 'text/plain' });
    const { result } = renderHook(() =>
      useConversationFileUpload({
        conversationId: 'conv-1',
      }),
    );

    act(() => {
      result.current.addFiles([file], ['local-done']);
    });

    await waitFor(() => {
      expect(MockXMLHttpRequest.instances).toHaveLength(1);
    });

    act(() => {
      MockXMLHttpRequest.instances[0]?.emitLoad(200);
    });

    await waitFor(() => {
      expect(result.current.files[0]?.status).toBe('completed');
    });

    deleteConversationFileMock.mockResolvedValue(undefined);

    act(() => {
      result.current.removeFile('local-done');
    });

    expect(deleteConversationFileMock).toHaveBeenCalledWith('conv-1', 'doc-1');
    expect(result.current.files).toHaveLength(0);
  });

  afterAll(() => {
    globalThis.XMLHttpRequest = originalXMLHttpRequest;
  });
});
