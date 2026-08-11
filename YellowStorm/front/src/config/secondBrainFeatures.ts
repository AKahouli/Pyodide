export const secondBrainFeatures = Object.freeze({
  enabled: import.meta.env.DEV || import.meta.env.VITE_SECOND_BRAIN_ENABLED === 'true',
});
