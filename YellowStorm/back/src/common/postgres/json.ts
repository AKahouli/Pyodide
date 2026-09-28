import { jsonb } from 'drizzle-orm/pg-core';

/** Typed jsonb column with a NOT NULL default. Use plain jsonb() when nullable. */
export function jsonbTyped<T>(name: string, defaultValue: T) {
  return jsonb(name).$type<T>().notNull().default(defaultValue);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Postgres rejects U+0000 in jsonb and text ("unsupported Unicode escape sequence")
 * where Mongo stored it, and one such character fails the whole statement and its
 * transaction. Event payloads and tool results carry model or tool output, so strip
 * it from every string and object key before a jsonb write.
 * Plain objects and arrays are copied, anything else is returned as is.
 */
export function stripNul<T>(value: T): T {
  if (typeof value === 'string') return value.replaceAll('\u0000', '') as T;
  if (Array.isArray(value)) return (value as unknown[]).map((item) => stripNul(item)) as T;
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key.replaceAll('\u0000', ''), stripNul(item)]),
    ) as T;
  }
  return value;
}
