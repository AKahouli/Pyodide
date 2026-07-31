import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UploadDropZone } from './UploadDropZone';

const addFilesToQueueMock = vi.fn();
const startUploadMock = vi.fn();
const validateFilesMock = vi.fn();

const state = {
  selectedWorkspace: { id: 'w-1' } as { id: string } | null,
};

vi.mock('../store', () => ({
  useSelectedWorkspace: () => state.selectedWorkspace,
  useWorkspaceStore: (selector: (s: { addFilesToQueue: typeof addFilesToQueueMock; startUpload: typeof startUploadMock }) => unknown) =>
    selector({ addFilesToQueue: addFilesToQueueMock, startUpload: startUploadMock }),
}));

vi.mock('../utils', () => ({
  validateFiles: (files: File[]) => validateFilesMock(files),
}));

describe('UploadDropZone', () => {
  beforeEach(() => {
    addFilesToQueueMock.mockReset();
    startUploadMock.mockReset();
    validateFilesMock.mockReset();
    validateFilesMock.mockImplementation((files: File[]) => ({ validFiles: files }));
    state.selectedWorkspace = { id: 'w-1' };
  });

  it('shows drag overlay and uploads dropped files', () => {
    const file = new File(['hello'], 'doc.pdf', { type: 'application/pdf' });

    render(
      <UploadDropZone>
        <div>content</div>
      </UploadDropZone>,
    );

    const zone = screen.getByText('content').parentElement as HTMLElement;
    fireEvent.dragEnter(zone, { dataTransfer: { types: ['Files'] } });
    expect(screen.getByText('upload.dropzone.title')).toBeInTheDocument();

    fireEvent.drop(zone, { dataTransfer: { files: [file] } });

    expect(addFilesToQueueMock).toHaveBeenCalledWith([file], 'w-1');
    expect(startUploadMock).toHaveBeenCalledTimes(1);
  });
});
