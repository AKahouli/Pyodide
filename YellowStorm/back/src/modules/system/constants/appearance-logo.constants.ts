/** CSS slot in the expanded sidebar: `h-12` × `max-w-56` (48×224px). */
export const APPEARANCE_LOGO_SLOT = {
  widthPx: 224,
  heightPx: 48,
} as const;

/** Native pixel bounds: 2× the sidebar slot so retina assets still fit. */
export const APPEARANCE_LOGO_CONSTRAINTS = {
  minWidth: 80,
  maxWidth: APPEARANCE_LOGO_SLOT.widthPx * 2,
  minHeight: 24,
  maxHeight: APPEARANCE_LOGO_SLOT.heightPx * 2,
  minAspectRatio: 1.2,
  maxAspectRatio: 10,
  maxBytes: 512 * 1024,
  maxSourceBytes: 8 * 1024 * 1024,
  maxCustomLogos: 20,
} as const;

export const APPEARANCE_LOGO_ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;

export const BUILTIN_APPEARANCE_LOGOS = [
  { id: 'yellowmind', name: 'Yellowmind' },
  { id: 'kpmg', name: 'KPMG' },
] as const;

export const BUILTIN_APPEARANCE_LOGO_IDS = BUILTIN_APPEARANCE_LOGOS.map((logo) => logo.id);

export const APPEARANCE_SETTINGS_KEY = 'appearance_settings';

export const APPEARANCE_COLOR_THEMES = ['default', 'yellow', 'orange', 'blue'] as const;
