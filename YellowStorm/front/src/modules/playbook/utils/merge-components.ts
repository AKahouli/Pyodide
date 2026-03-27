/**
 * Merge new components with existing humanFeedback components.
 * If SSE already includes HF components, use them as-is.
 * Otherwise, preserve existing HF components and prepend them before new ones.
 */
export function mergeComponents<T extends { type: string }>(
  existingComponents: T[] | undefined,
  newComponents: T[],
): T[] | undefined {
  const sseHasHf = newComponents.some((c) => c.type === 'humanFeedback');
  if (sseHasHf) {
    return newComponents;
  }
  if (newComponents.length > 0) {
    const existingHf = (existingComponents || []).filter((c) => c.type === 'humanFeedback');
    return existingHf.length > 0 ? [...existingHf, ...newComponents] : newComponents;
  }
  return existingComponents;
}
