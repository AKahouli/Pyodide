import { jsonb } from 'drizzle-orm/pg-core';

/** Typed jsonb column with a NOT NULL default. Use plain jsonb() when nullable. */
export function jsonbTyped<T>(name: string, defaultValue: T) {
  return jsonb(name).$type<T>().notNull().default(defaultValue);
}
