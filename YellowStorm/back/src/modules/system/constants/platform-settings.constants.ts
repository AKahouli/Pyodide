/**
 * Platform settings admin-managed via catalog.system_settings (`platform_settings`).
 * Defaults mirror the former THROTTLE_*, AUTH_MAX_SESSIONS_PER_USER and STORAGE_*
 * env variables; admins can change these at runtime via admin/platform-settings.
 */
export const PLATFORM_SETTINGS_KEY = 'platform_settings';

export const DEFAULT_ALLOWED_UPLOAD_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
  'text/markdown',
  'application/json',
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
] as const;

export interface PlatformSettingsValue {
  throttle: {
    /** Max requests per window across the default rate limiter. */
    limit: number;
    /** Rate limiter window in seconds. */
    windowSeconds: number;
  };
  auth: {
    maxSessionsPerUser: number;
  };
  documentUpload: {
    maxFileSizeMb: number;
    maxFilesPerUpload: number;
    /** Empty list means "allow all". */
    allowedMimeTypes: string[];
  };
}

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettingsValue = {
  throttle: {
    limit: 100,
    windowSeconds: 60,
  },
  auth: {
    maxSessionsPerUser: 10,
  },
  documentUpload: {
    maxFileSizeMb: 50,
    maxFilesPerUpload: 10,
    allowedMimeTypes: [...DEFAULT_ALLOWED_UPLOAD_MIME_TYPES],
  },
};

const boundedInteger = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value)))
    : fallback;

/** Deep-partial update payload; omitted fields keep their current value. */
export type PartialPlatformSettings = {
  [K in keyof PlatformSettingsValue]?: Partial<PlatformSettingsValue[K]>;
};

export function normalizePlatformSettings(value?: PartialPlatformSettings | null): PlatformSettingsValue {
  const defaults = DEFAULT_PLATFORM_SETTINGS;
  const rawMimeTypes = value?.documentUpload?.allowedMimeTypes;
  let allowedMimeTypes: string[];
  if (!Array.isArray(rawMimeTypes)) {
    allowedMimeTypes = [...defaults.documentUpload.allowedMimeTypes];
  } else {
    const filtered = rawMimeTypes.filter((entry): entry is string => typeof entry === 'string');
    const seenMimeTypes = new Set<string>();
    allowedMimeTypes = filtered.filter((entry) => {
      if (seenMimeTypes.has(entry)) return false;
      seenMimeTypes.add(entry);
      return true;
    });
    // A present-but-garbage list must not silently become "allow all".
    if (rawMimeTypes.length > 0 && allowedMimeTypes.length === 0) {
      allowedMimeTypes = [...defaults.documentUpload.allowedMimeTypes];
    }
  }

  return {
    throttle: {
      limit: boundedInteger(value?.throttle?.limit, defaults.throttle.limit, 1, 100000),
      windowSeconds: boundedInteger(value?.throttle?.windowSeconds, defaults.throttle.windowSeconds, 1, 86400),
    },
    auth: {
      maxSessionsPerUser: boundedInteger(value?.auth?.maxSessionsPerUser, defaults.auth.maxSessionsPerUser, 1, 1000),
    },
    documentUpload: {
      maxFileSizeMb: boundedInteger(value?.documentUpload?.maxFileSizeMb, defaults.documentUpload.maxFileSizeMb, 1, 4096),
      maxFilesPerUpload: boundedInteger(value?.documentUpload?.maxFilesPerUpload, defaults.documentUpload.maxFilesPerUpload, 1, 100),
      allowedMimeTypes,
    },
  };
}
