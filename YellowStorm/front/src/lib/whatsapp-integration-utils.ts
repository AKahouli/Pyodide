import { parseApiError } from '@/lib/api-error';

const WHATSAPP_NETWORK_ERROR_CODE = 'ERR_3219';

export function normalizeQrDataUrl(qrCode: string | undefined): string | undefined {
  if (!qrCode) return undefined;
  if (qrCode.startsWith('data:')) return qrCode;
  return `data:image/png;base64,${qrCode}`;
}

export function formatPairingCodeDisplay(code: string | undefined): string | undefined {
  if (!code) return undefined;
  const digits = code.replace(/\D/g, '');
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  }
  return code;
}

export function isWhatsAppConnected(status: string | undefined): boolean {
  return status === 'CONNECTED';
}

export function isWhatsAppPairing(status: string | undefined): boolean {
  return status === 'PAIRING';
}

export function isWhatsAppFailed(status: string | undefined): boolean {
  return status === 'FAILED';
}

export function isWhatsAppNotConnected(
  integration: { status?: string } | null,
): boolean {
  if (!integration) return true;
  return integration.status === 'DISCONNECTED' || !integration.status;
}

export function isWhatsAppNetworkError(codeOrMessage: string | undefined): boolean {
  if (!codeOrMessage) return false;
  if (codeOrMessage === WHATSAPP_NETWORK_ERROR_CODE) return true;
  const lower = codeOrMessage.toLowerCase();
  return (
    lower.includes('web.whatsapp.com') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('cannot reach web.whatsapp.com')
  );
}

export function resolveWhatsAppErrorMessage(
  codeOrMessage: string | undefined,
  networkUnreachableLabel: string,
): string {
  if (!codeOrMessage) return '';
  if (isWhatsAppNetworkError(codeOrMessage)) {
    return networkUnreachableLabel;
  }
  return codeOrMessage;
}

/** Maps API / axios rejections to a user-facing WhatsApp error string. */
export function resolveWhatsAppApiError(
  error: unknown,
  networkUnreachableLabel: string,
): string {
  const apiError = parseApiError(error);
  return (
    resolveWhatsAppErrorMessage(apiError.code, networkUnreachableLabel) ||
    resolveWhatsAppErrorMessage(apiError.message, networkUnreachableLabel) ||
    networkUnreachableLabel
  );
}
