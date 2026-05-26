const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'blob:']);

export function getSafeArtifactUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed, 'https://yellowstorm.local');
    return SAFE_PROTOCOLS.has(parsed.protocol) ? trimmed : null;
  } catch {
    return null;
  }
}
