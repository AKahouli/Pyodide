import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceUploadDropZone } from './WorkspaceUploadDropZone';
const upload = vi.hoisted(() => vi.fn());
vi.mock('../store', () => ({ useCanWriteWorkspace: () => true, useWorkspaceStore: (selector: (state: unknown) => unknown) => selector({ uploadPageFiles: upload, selectedWorkspaceId: 'workspace', addLinkDialog: { open: false }, openAddLink: vi.fn(), closeAddLink: vi.fn(), isUploading: false }) }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../hooks/useAllowedUploadExtensions', () => ({ useAllowedUploadExtensions: () => ({ accept: '.pdf', maxFileSize: 1048576 }) }));
vi.mock('./AddLinkDialog', () => ({ AddLinkDialog: () => null }));

describe('WorkspaceUploadDropZone', () => {
  beforeEach(() => vi.clearAllMocks());
  it('provides a native folder picker and forwards browser relative paths unchanged', () => {
    render(<WorkspaceUploadDropZone expanded />);
    const picker = screen.getByLabelText('uploadActivity.folder');
    expect(picker).toHaveAttribute('webkitdirectory');
    const file = new File(['data'], 'report.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'webkitRelativePath', { value: 'Reports/2026/report.pdf' });
    fireEvent.change(picker, { target: { files: [file] } });
    expect(upload).toHaveBeenCalledWith([file], expect.objectContaining({ autoIndex: expect.any(Boolean), deepSearch: expect.any(Boolean) }));
    expect(upload.mock.calls[0][0][0].webkitRelativePath).toBe('Reports/2026/report.pdf');
  });
});
