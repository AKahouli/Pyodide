import { API_CONFIG, API_ENDPOINTS } from '@/lib/api/config';

export function appearanceLogoSrc(logo: { id: string; kind: string; updatedAt?: string }): string | undefined {
  if (logo.kind !== 'custom') {
    return undefined;
  }
  const base = API_CONFIG.baseURL.replace(/\/$/, '');
  const url = `${base}${API_ENDPOINTS.system.appearanceLogoFile(logo.id)}`;
  const version = logo.updatedAt ?? '0';
  return `${url}?v=${encodeURIComponent(version)}`;
}
