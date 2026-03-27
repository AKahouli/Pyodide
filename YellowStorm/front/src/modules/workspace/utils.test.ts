import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_FILES_PER_UPLOAD, MAX_FILE_SIZE, formatFileSize, getFileTypeLabel, validateFiles } from './utils';

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: toastMock,
}));

describe('workspace utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('formats file sizes and resolves file type labels', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(1536)).toBe('1.5 KB');
    expect(getFileTypeLabel('application/pdf')).toBe('PDF');
    expect(getFileTypeLabel('application/x-custom')).toBe('X-CUSTOM');
    expect(getFileTypeLabel('')).toBe('FILE');
  });

  it('rejects upload batch above maximum allowed file count', () => {
    const files = Array.from({ length: MAX_FILES_PER_UPLOAD + 1 }, (_, index) => new File(['x'], `file-${index}.txt`, { type: 'text/plain' }));
    const result = validateFiles(files);

    expect(result.validFiles).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
    expect(toastMock.error).toHaveBeenCalledWith(`Maximum ${MAX_FILES_PER_UPLOAD} files allowed per upload`);
  });

  it('accepts valid files and reports rejected files', () => {
    const validFile = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const invalidTypeFile = new File(['abc'], 'script.exe', { type: 'application/x-msdownload' });
    const emptyFile = new File([], 'empty.txt', { type: 'text/plain' });
    const tooLargeFile = new File(['x'], 'large.pdf', { type: 'application/pdf' });
    Object.defineProperty(tooLargeFile, 'size', { value: MAX_FILE_SIZE + 1 });

    const result = validateFiles([validFile, invalidTypeFile, emptyFile, tooLargeFile]);

    expect(result.validFiles).toHaveLength(1);
    expect(result.validFiles[0]?.name).toBe('notes.txt');
    expect(result.errors).toHaveLength(3);
    expect(toastMock.error).toHaveBeenCalledWith('Some files were rejected', expect.objectContaining({ description: expect.any(String) }));
  });
});
