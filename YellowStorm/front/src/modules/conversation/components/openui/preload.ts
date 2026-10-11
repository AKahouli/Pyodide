import type { Agent } from '@/modules/agent/types';
import { resolveAnswerRenderMode } from './render-mode';

type RendererModule = typeof import('./OpenUiRenderer');

let pending: Promise<RendererModule> | null = null;

/**
 * The one dynamic import of the OpenUI chunk; the preloads and the `lazy()` in OpenUiAnswer share
 * its promise. A failed import is forgotten here, so each new call retries; `lazy()` itself caches
 * a rejection, which is why OpenUiAnswer retries inside its factory and recreates its component.
 */
export function loadOpenUiRenderer(): Promise<RendererModule> {
  pending ??= import('./OpenUiRenderer').catch((error: unknown) => {
    // Forget the failed load so the next caller retries instead of re-using the rejection.
    pending = null;
    throw error;
  });
  return pending;
}

/**
 * Warms the OpenUI chunk for an agent that is about to answer in OpenUI Lang
 * (tagged in the composer, the conversation's agent, or named by a stream
 * start), so the first answer does not wait on the download. Failures are
 * left to the real render, which retries the load and has its own fallback.
 */
export function preloadOpenUiForAgent(agent: Pick<Agent, 'slug'> | undefined | null): void {
  if (resolveAnswerRenderMode(agent) !== 'openui') return;
  loadOpenUiRenderer().catch(() => undefined);
}
