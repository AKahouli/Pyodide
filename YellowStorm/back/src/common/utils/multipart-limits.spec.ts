import {
  MULTIPART_SKILL_IMPORT_MAX_BYTES,
  MULTIPART_SMALL_FILE_MAX_BYTES,
  MULTIPART_STT_MAX_BYTES,
  multipartFileInterceptorOptions,
} from './multipart-limits';

describe('multipart-limits', () => {
  it('exposes positive endpoint-specific byte caps', () => {
    expect(MULTIPART_SMALL_FILE_MAX_BYTES).toBeGreaterThan(0);
    expect(MULTIPART_STT_MAX_BYTES).toBeGreaterThan(0);
    expect(MULTIPART_SKILL_IMPORT_MAX_BYTES).toBeGreaterThan(0);
  });

  it('builds Multer limits with a single file and field cap', () => {
    expect(multipartFileInterceptorOptions(5 * 1024 * 1024)).toEqual({
      limits: {
        fileSize: 5 * 1024 * 1024,
        files: 1,
        fields: 10,
      },
    });
  });
});
