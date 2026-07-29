import { API_CONFIG } from './api/config';

function getAppOrigin(): string {
  try {
    if (typeof window !== 'undefined') {
      return window.location.origin.replace(/\/$/, '');
    }
  } catch {}
  return '';
}

function getApiOrigin(): string {
  const base = API_CONFIG.baseURL;
  if (base === 'MY_APP_VITE_API_URL') {
    return getAppOrigin();
  }
  try {
    const url = new URL(base, 'http://localhost');
    return url.origin.replace(/\/$/, '');
  } catch {
    return '';
  }
}

export interface UrlValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateExternalUrl(raw: string): UrlValidationResult {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { valid: false, reason: 'Invalid URL' };
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { valid: false, reason: 'Only http/https URLs allowed' };
  }

  const appOrigin = getAppOrigin();
  const apiOrigin = getApiOrigin();
  const targetOrigin = url.origin.replace(/\/$/, '');

  if (appOrigin && targetOrigin === appOrigin) {
    return { valid: false, reason: 'Application origin blocked' };
  }
  if (apiOrigin && targetOrigin === apiOrigin) {
    return { valid: false, reason: 'API origin blocked' };
  }

  return { valid: true };
}

export const EXTERNAL_SANDBOX = 'allow-scripts';

export function getExternalReferrerPolicy(): 'no-referrer' {
  return 'no-referrer';
}
