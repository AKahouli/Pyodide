import { API_CONFIG, API_ENDPOINTS } from '@/lib/api/config';
import type { AppearanceLogo } from '@/modules/admin/types';

export function appearanceLogoSrc(logo: Pick<AppearanceLogo, 'id' | 'kind' | 'updatedAt'>): string | undefined {
  if (logo.kind !== 'custom') {
    return undefined;
  }
  const base = API_CONFIG.baseURL.replace(/\/$/, '');
  const url = `${base}${API_ENDPOINTS.system.appearanceLogoFile(logo.id)}`;
  const version = logo.updatedAt ?? '0';
  return `${url}?v=${encodeURIComponent(version)}`;
}
