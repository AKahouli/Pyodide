import { char, customType, timestamp } from 'drizzle-orm/pg-core';

/**
 * Shared Drizzle column helpers for the app-owned PostgreSQL datastore.
 * Convention (see conversation.schema.ts): ids are char(24) application-generated
 * hex strings, timestamps are timestamptz defaulting to now().
 */

/** bytea column — node-postgres maps it to/from Buffer. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export function objectId(name: string) {
  return char(name, { length: 24 });
}

export function objectIdArray(name: string) {
  return char(name, { length: 24 }).array();
}

export function timestamps() {
  return {
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  };
}
