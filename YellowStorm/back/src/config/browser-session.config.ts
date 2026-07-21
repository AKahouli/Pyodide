import { registerAs } from '@nestjs/config';

export default registerAs('browserSession', () => ({
  idleMs: Number.parseInt(process.env.BROWSER_SESSION_IDLE_MS || '300000', 10),
  maxMs: Number.parseInt(process.env.BROWSER_SESSION_MAX_MS || '1200000', 10),
  maxConcurrent: Number.parseInt(process.env.BROWSER_SESSION_MAX_CONCURRENT || '10', 10),
  // 16:9 viewport — must match the frontend VIEWPORT_W/H constants so streamed
  // input coordinates map correctly.
  viewportWidth: Number.parseInt(process.env.BROWSER_SESSION_VIEWPORT_W || '1280', 10),
  viewportHeight: Number.parseInt(process.env.BROWSER_SESSION_VIEWPORT_H || '720', 10),
  screencastQuality: Number.parseInt(process.env.BROWSER_SESSION_SCREENCAST_QUALITY || '80', 10),
  chromiumExecutablePath: process.env.BROWSER_SESSION_CHROMIUM_PATH || '',
}));
