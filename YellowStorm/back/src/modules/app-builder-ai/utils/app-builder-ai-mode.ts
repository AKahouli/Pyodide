/** Shared App Builder AI Proxy mode helpers (preview + end-user). */
export function isAppBuilderAiProxyMode(
  mode: string | undefined,
): mode is 'ai_preview' | 'app_end_user' {
  return mode === 'ai_preview' || mode === 'app_end_user';
}
