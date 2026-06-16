export const WHATSAPP_SW_JS_URL = 'https://web.whatsapp.com/sw.js';

export const WHATSAPP_NETWORK_UNREACHABLE_MESSAGE =
  'Cannot reach web.whatsapp.com from this server (connection reset or timeout). ' +
  'Allow HTTPS/WSS to web.whatsapp.com and disable blocking VPN/firewall.';

export function isWhatsAppTransportError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes('econnreset') ||
    lower.includes('etimedout') ||
    lower.includes('enotfound') ||
    lower.includes('socket hang up') ||
    lower.includes('network unreachable')
  );
}
