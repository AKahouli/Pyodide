import { UAParser } from 'ua-parser-js';
import type { DeviceInfoData } from '../interfaces/auth.interface';

/**
 * Parses a User-Agent header into the bounded device shape stored on sessions
 * and reused by the new-location alert email.
 */
export function parseUserAgent(userAgent: string): DeviceInfoData {
  const parser = new UAParser(userAgent);
  const result = parser.getResult();

  return {
    userAgent,
    browser: result.browser.name,
    browserVersion: result.browser.version,
    os: result.os.name,
    osVersion: result.os.version,
    device: result.device.model,
    deviceType: result.device.type ?? 'desktop',
  };
}
