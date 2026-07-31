import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { UploadButton } from './UploadButton';

const addFilesToQueueMock = vi.fn();
const startUploadMock = vi.fn();
const validateFilesMock = vi.fn();

const state = {
  selectedWorkspace: { id: 'w-1' } as { id: string } | null,
  isUploading: false,
};

vi.mock('../store', () => ({
  useSelectedWorkspace: () => state.selectedWorkspace,
  useWorkspaceStore: (selector: (s: { addFilesToQueue: typeof addFilesToQueueMock; startUpload: typeof startUploadMock; isUploading: boolean }) => unknown) =>
    selector({ addFilesToQueue: addFilesToQueueMock, startUpload: startUploadMock, isUploading: state.isUploading }),
}));

vi.mock('../utils', () => ({
  ACCEPT_EXTENSIONS: '.pdf',
  validateFiles: (files: File[]) => validateFilesMock(files),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('@/components/ui/button', () => ({ Button: ({ children, onClick, disabled, title }: { children: ReactNode; onClick?: () => void; disabled?: boolean; title?: string }) => <button type='button' onClick={onClick} disabled={disabled} title={title}>{children}</button> }));

describe('UploadButton', () => {
  beforeEach(() => {
    addFilesToQueueMock.mockReset();
    startUploadMock.mockReset();
    vi.mocked(toast.error).mockReset();
    validateFilesMock.mockReset();
    validateFilesMock.mockReturnValue({ validFiles: [] });
    state.selectedWorkspace = { id: 'w-1' };
    state.isUploading = false;
  });

  it('queues valid files and starts upload', () => {
    const file = new File(['hello'], 'doc.pdf', { type: 'application/pdf' });
    validateFilesMock.mockReturnValue({ validFiles: [file] });

    render(<UploadButton />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(addFilesToQueueMock).toHaveBeenCalledWith([file], 'w-1');
    expect(startUploadMock).toHaveBeenCalledTimes(1);
  });

  it('shows an error toast when workspace is not selected', () => {
    const file = new File(['hello'], 'doc.pdf', { type: 'application/pdf' });
    state.selectedWorkspace = null;

    render(<UploadButton />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });

    expect(toast.error).toHaveBeenCalledWith('upload.dropzone.selectWorkspace');
    expect(startUploadMock).not.toHaveBeenCalled();
  });
});
