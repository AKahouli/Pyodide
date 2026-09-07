/**
 * Module-local rollout flags for the conversation module.
 * Build-time `VITE_*` values — see FRONTEND_GUIDELINES §5 (feature flags).
 * Declare new keys in `src/vite-env.d.ts` and the deployment env template.
 */
export const conversationFeatures = Object.freeze({
  /**
   * Latency icon/popover under completed assistant answers. Data itself is
   * only present after backend+ADK deploy the instrumentation, so messages
   * without metrics are unaffected even when this is enabled.
   */
  latencyUiEnabled: import.meta.env.VITE_CONVERSATION_LATENCY_UI_ENABLED !== 'false',
});
