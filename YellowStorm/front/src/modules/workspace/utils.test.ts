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

  it('accepts the configured boundary and rejects one byte above it', () => {
    const atLimit = new File(['x'], 'at.pdf', { type: 'application/pdf' });
    const aboveLimit = new File(['x'], 'above.pdf', { type: 'application/pdf' });
    const limit = 50 * 1024 * 1024;
    Object.defineProperty(atLimit, 'size', { value: limit, configurable: true });
    Object.defineProperty(aboveLimit, 'size', { value: limit + 1 });
    expect(validateFiles([atLimit, aboveLimit], limit)).toEqual({
      validFiles: [atLimit], errors: ['above.pdf: File too large (max 50 MB)'],
    });
    expect(validateFiles([aboveLimit], 200 * 1024 * 1024).validFiles).toEqual([aboveLimit]);
    Object.defineProperty(atLimit, 'size', { value: 600 * 1024 * 1024, configurable: true });
    expect(validateFiles([atLimit], 700 * 1024 * 1024).validFiles).toEqual([atLimit]);
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
