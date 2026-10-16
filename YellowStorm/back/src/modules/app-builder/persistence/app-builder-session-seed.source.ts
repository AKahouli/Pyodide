import { Inject, Injectable } from '@nestjs/common';
import type {
  RuntimeSessionSeed,
  RuntimeSessionSeedSource,
} from '@modules/app-runtime/ports/runtime-session-seed.port';
import { PgAppBuilderSessionStore } from './postgres/pg-app-builder-session.store';

/** Exposes session seed revisions to App Runtime through RUNTIME_SESSION_SEED_SOURCE. */
@Injectable()
export class AppBuilderSessionSeedSource implements RuntimeSessionSeedSource {
  constructor(
    @Inject(PgAppBuilderSessionStore)
    private readonly sessions: PgAppBuilderSessionStore,
  ) {}

  async findSeedByAiSessionId(aiSessionId: string): Promise<RuntimeSessionSeed | null> {
    const session = await this.sessions.findByAiSessionId(aiSessionId);
    if (!session) {
      return null;
    }
    return { starterRevisionId: session.starterRevisionId ?? null };
  }
}