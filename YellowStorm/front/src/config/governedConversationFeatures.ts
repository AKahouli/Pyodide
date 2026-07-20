const enabled = (value: unknown): boolean => String(value).toLowerCase() === 'true';

export const governedConversationFeatures = {
  conversationsEnabled: enabled(import.meta.env.VITE_GOVERNED_CONVERSATIONS_ENABLED),
  carouselEnabled: enabled(import.meta.env.VITE_GOVERNED_SCOPE_CAROUSEL_ENABLED),
};
