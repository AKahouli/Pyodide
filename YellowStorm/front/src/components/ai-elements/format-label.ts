/** Turns "hello_world-foo" into "Hello World Foo" */
export const formatLabel = (raw: string): string => {
  if (!raw) return '';
  return raw
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
};
