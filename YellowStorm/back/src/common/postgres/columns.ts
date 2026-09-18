import { char, timestamp } from 'drizzle-orm/pg-core';

/**
 * Shared Drizzle column helpers for the app-owned PostgreSQL datastore.
 * Convention (see conversation.schema.ts): ids are char(24) application-generated
 * hex strings, timestamps are timestamptz defaulting to now().
 */

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
