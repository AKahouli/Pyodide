import { Inject, Injectable } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { withTransaction } from '@common/postgres/transaction';
import type { GovernanceTransactionRunner } from '../transaction-runner';

@Injectable()
export class PgGovernanceTransactionRunner implements GovernanceTransactionRunner {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  run<R>(fn: () => Promise<R>): Promise<R> {
    return withTransaction(this.db, () => fn());
  }
}
