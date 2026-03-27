import { describe, expect, it } from 'vitest';
import { getMimeTypeFromFilename, getRenderer, isViewableFile, isViewableFilename } from './index';

describe('file-viewer renderer registry', () => {
  it('resolves known renderer by mime type', () => {
    expect(getRenderer('application/pdf')).not.toBeNull();
    expect(getRenderer('application/unknown-type')).toBeNull();
  });

  it('detects viewable mime and filename', () => {
    expect(isViewableFile('image/png')).toBe(true);
    expect(isViewableFile('application/zip')).toBe(false);

    expect(getMimeTypeFromFilename('report.pdf')).toBe('application/pdf');
    expect(getMimeTypeFromFilename('script.ts')).toBe('text/typescript');
    expect(getMimeTypeFromFilename('noext')).toBeNull();

    expect(isViewableFilename('chart.xlsx')).toBe(true);
    expect(isViewableFilename('archive.7z')).toBe(false);
  });
});
