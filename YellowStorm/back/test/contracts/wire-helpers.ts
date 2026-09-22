/**
 * Shared helpers for the pure (DB-free) contract specs: build the wire object
 * from the module's real mapping code, then assert leak-proof invariants.
 */

/** JSON round-trip: what the client actually receives (Dates -> ISO, undefined dropped). */
export function toWire<T = any>(value: unknown): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Call a private/instance method of a service without constructing it (the
 * mappers under test do not touch injected dependencies). `deps` can supply
 * fields the mapper reads through `this`.
 */
export function callPrivate<T = any>(
  Class: { prototype: object },
  method: string,
  args: unknown[],
  deps: Record<string, unknown> = {},
): T {
  const self = Object.assign(Object.create(Class.prototype), deps);
  return (self[method] as (...a: unknown[]) => T).apply(self, args);
}

/** Recursively collect every key path matching `keyPattern`. */
export function findKeys(value: unknown, keyPattern: RegExp, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => findKeys(v, keyPattern, `${path}[${i}]`));
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [
      ...(keyPattern.test(k) ? [`${path}.${k}`] : []),
      ...findKeys(v, keyPattern, `${path}.${k}`),
    ]);
  }
  return [];
}

/** No Mongo-era leftovers anywhere in the payload. */
export function expectNoMongoKeys(body: unknown): void {
  expect(findKeys(body, /^(_id|__v)$/)).toEqual([]);
}

/** None of the given secret-ish keys appear anywhere in the payload. */
export function expectNoKeys(body: unknown, ...keys: string[]): void {
  expect(findKeys(body, new RegExp(`^(${keys.join('|')})$`))).toEqual([]);
}
