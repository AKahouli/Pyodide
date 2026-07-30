/**
 * Hard Multer limits applied at multipart parse time so oversized bodies are
 * rejected before the full request is buffered into memory (YS-02 / CWE-400).
 *
 * Values mirror the downstream service checks (workspace small-file threshold,
 * Worky STT max bytes). Skill import has no prior limit; 10MB caps ZIP parse cost.
 */

export const MULTIPART_SMALL_FILE_MAX_BYTES =
  Number.parseInt(process.env.WORKSPACE_SMALL_FILE_THRESHOLD_MB || '10', 10) *
  1024 *
  1024;

export const MULTIPART_STT_MAX_BYTES = Number.parseInt(
  process.env.WORKY_STT_MAX_BYTES || '26214400',
  10,
);

export const MULTIPART_SKILL_IMPORT_MAX_BYTES = Number.parseInt(
  process.env.SKILL_IMPORT_MAX_BYTES || String(10 * 1024 * 1024),
  10,
);

/** Nest `FileInterceptor` options: one file, bounded fields, hard byte cap. */
export function multipartFileInterceptorOptions(fileSizeBytes: number) {
  return {
    limits: {
      fileSize: fileSizeBytes,
      files: 1,
      fields: 10,
    },
  };
}
