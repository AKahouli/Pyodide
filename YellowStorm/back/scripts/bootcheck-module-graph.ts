/**
 * Verifies the Nest module graph resolves (catches "module at index [N] is
 * undefined" circular-dependency errors) WITHOUT instantiating providers or
 * connecting to any database. Uses preview mode.
 * Usage: npx ts-node back/scripts/bootcheck-module-graph.ts
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { preview: true, logger: ['error'] });
  await app.close();
  console.log('MODULE GRAPH OK — preview scan passed (no undefined/circular module imports).');
}

main().catch((e) => {
  console.error('MODULE GRAPH FAILED:', (e as Error).message);
  process.exit(1);
});
