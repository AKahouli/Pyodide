import {
  DEFAULT_PLATFORM_SETTINGS,
  normalizePlatformSettings,
  type PartialPlatformSettings,
} from './platform-settings.constants';

describe('normalizePlatformSettings', () => {
  it('returns defaults for empty input', () => {
    expect(normalizePlatformSettings(null)).toEqual(DEFAULT_PLATFORM_SETTINGS);
  });

  it('bounds integers to the allowed ranges', () => {
    const result = normalizePlatformSettings({
      throttle: { limit: -5, windowSeconds: 999_999 },
      auth: { maxSessionsPerUser: 0 },
      documentUpload: { maxFileSizeMb: 99_999, maxFilesPerUpload: 1_000 },
    } as PartialPlatformSettings);

    expect(result.throttle.limit).toBe(1);
    expect(result.throttle.windowSeconds).toBe(86400);
    expect(result.auth.maxSessionsPerUser).toBe(1);
    expect(result.documentUpload.maxFileSizeMb).toBe(4096);
    expect(result.documentUpload.maxFilesPerUpload).toBe(100);
  });

  it('dedupes MIME types and keeps an empty allow-all list explicit', () => {
    const result = normalizePlatformSettings({
      documentUpload: { allowedMimeTypes: ['application/pdf', 'application/pdf', 'text/plain'] },
    } as PartialPlatformSettings);
    expect(result.documentUpload.allowedMimeTypes).toEqual(['application/pdf', 'text/plain']);

    expect(normalizePlatformSettings({ documentUpload: { allowedMimeTypes: [] } }).documentUpload.allowedMimeTypes).toEqual([]);
  });

  it('ignores non-string MIME entries and falls back to defaults for missing sections', () => {
    const result = normalizePlatformSettings({
      documentUpload: { allowedMimeTypes: [42 as unknown as string] },
    } as PartialPlatformSettings);
    expect(result.documentUpload.allowedMimeTypes).toEqual(DEFAULT_PLATFORM_SETTINGS.documentUpload.allowedMimeTypes);
    expect(result.throttle).toEqual(DEFAULT_PLATFORM_SETTINGS.throttle);
  });
});
