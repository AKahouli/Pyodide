import { LoggerService } from '@modules/logger';
import { loadBaileys } from './baileys-loader';
import { WHATSAPP_SW_JS_URL } from './whatsapp-network.util';

type WaVersion = [number, number, number];

let cachedVersion: WaVersion | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 60 * 60 * 1000;

function parseVersionFromSwJs(body: string): WaVersion | null {
  const match = body.match(/client_revision["']?\s*:\s*(\d+)/);
  if (!match) return null;
  const revision = parseInt(match[1], 10);
  return [2, 3000, revision];
}

/**
 * Resolves the WhatsApp Web client version from sw.js.
 * Bundled baileys-version.json is often stale and causes ECONNRESET before QR is emitted.
 */
export async function resolveWhatsAppWebVersion(
  logger: LoggerService,
  timeoutMs = 10000,
): Promise<WaVersion> {
  if (cachedVersion && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedVersion;
  }

  const baileys = await loadBaileys();
  const fallback: WaVersion = [2, 3000, 1023223821];

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(WHATSAPP_SW_JS_URL, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YellowStorm/1.0)' },
    });
    clearTimeout(timer);

    if (!response.ok) {
      throw new Error(`sw.js HTTP ${response.status}`);
    }

    const body = await response.text();
    const parsed = parseVersionFromSwJs(body);
    if (parsed) {
      cachedVersion = parsed;
      cachedAt = Date.now();
      logger.log('WhatsApp version resolved from sw.js', { version: parsed });
      return parsed;
    }
  } catch (error) {
    logger.warn('Failed to fetch WhatsApp sw.js for version resolution', {
      error: (error as Error).message,
      fallbackVersion: fallback,
    });
  }

  try {
    const { version, isLatest } = await baileys.fetchLatestBaileysVersion();
    cachedVersion = version;
    cachedAt = Date.now();
    logger.log('WhatsApp version from Baileys GitHub fallback', { version, isLatest });
    return version;
  } catch (error) {
    logger.warn('Baileys fetchLatestBaileysVersion failed; using bundled version', {
      error: (error as Error).message,
      fallbackVersion: fallback,
    });
    return fallback;
  }
}
