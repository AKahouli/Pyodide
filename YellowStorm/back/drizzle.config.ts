import { defineConfig } from 'drizzle-kit';

const host = process.env.POSTGRES_HOST || 'localhost';
const port = process.env.POSTGRES_PORT || '5432';
const user = process.env.POSTGRES_USER || 'postgres';
const password = process.env.POSTGRES_PASSWORD || 'postgres';
const database = process.env.POSTGRES_DB || 'yellostorm';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/modules/postgres/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: `postgresql://${user}:${password}@${host}:${port}/${database}`,
  },
});
