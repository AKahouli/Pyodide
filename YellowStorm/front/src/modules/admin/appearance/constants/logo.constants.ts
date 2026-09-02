/** CSS slot in the expanded sidebar: `h-12` × `max-w-56` (48×224px). */
export const APPEARANCE_LOGO_SLOT = {
  widthPx: 224,
  heightPx: 48,
} as const;

/** 2× the sidebar slot so the stored PNG stays sharp on retina displays. */
export const APPEARANCE_LOGO_OUTPUT = {
  widthPx: APPEARANCE_LOGO_SLOT.widthPx * 2,
  heightPx: APPEARANCE_LOGO_SLOT.heightPx * 2,
} as const;

export const APPEARANCE_LOGO_ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;

export const APPEARANCE_LOGO_ACCEPT = APPEARANCE_LOGO_ALLOWED_MIMES.join(',');

export const APPEARANCE_LOGO_CONSTRAINTS = {
  minWidth: 80,
  minHeight: 24,
  minAspectRatio: 1.2,
  maxAspectRatio: 10,
  maxSourceBytes: 8 * 1024 * 1024,
  maxSourceEdge: 8000,
  maxOutputBytes: 512 * 1024,
} as const;
