import { registerAs } from '@nestjs/config';

/**
 * Connection to the external "thematic_memory" Postgres database that holds
 * agent memory cards (table `memory_cards_metadata`). Separate from the primary
 * MongoDB; only this feature talks to it.
 */
export default registerAs('memoryCards', () => ({
  host: process.env.MEMORY_PG_HOST || '',
  port: Number.parseInt(process.env.MEMORY_PG_PORT || '5432', 10),
  user: process.env.MEMORY_PG_USER || '',
  password: process.env.MEMORY_PG_PASSWORD || '',
  database: process.env.MEMORY_PG_DB || '',
  ssl: process.env.MEMORY_PG_SSL === 'true',
}));
