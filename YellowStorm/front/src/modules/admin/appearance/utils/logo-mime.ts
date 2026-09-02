import { APPEARANCE_LOGO_ALLOWED_MIMES, APPEARANCE_LOGO_CONSTRAINTS } from '../constants';

export type LogoFileIssue = 'type' | 'unreadable' | 'size' | 'dimensions';

export function normalizeLogoMime(mime: string): string {
  const normalized = mime.trim().toLowerCase();
  if (normalized === 'image/jpg') {
    return 'image/jpeg';
  }
  if (normalized === 'image/x-png') {
    return 'image/png';
  }
  return normalized;
}

export function isAllowedLogoFile(file: File): boolean {
  if (file.type) {
    return (APPEARANCE_LOGO_ALLOWED_MIMES as readonly string[]).includes(normalizeLogoMime(file.type));
  }
  return /\.(png|jpe?g|webp)$/i.test(file.name);
}

export function validateLogoSourceDimensions(width: number, height: number): boolean {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return false;
  }
  if (width < APPEARANCE_LOGO_CONSTRAINTS.minWidth || height < APPEARANCE_LOGO_CONSTRAINTS.minHeight) {
    return false;
  }
  if (width > APPEARANCE_LOGO_CONSTRAINTS.maxSourceEdge || height > APPEARANCE_LOGO_CONSTRAINTS.maxSourceEdge) {
    return false;
  }
  const aspect = width / height;
  return aspect >= APPEARANCE_LOGO_CONSTRAINTS.minAspectRatio && aspect <= APPEARANCE_LOGO_CONSTRAINTS.maxAspectRatio;
}
