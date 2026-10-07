import { Inject, Injectable } from '@nestjs/common';
import type {
  RuntimeSessionSeed,
  RuntimeSessionSeedSource,
} from '@modules/app-runtime/ports/runtime-session-seed.port';
import { PgConversationV2SessionStore } from './postgres/pg-conversation-v2-session.store';

/** Exposes session seed revisions to App Runtime through RUNTIME_SESSION_SEED_SOURCE. */
@Injectable()
export class ConversationV2SessionSeedSource implements RuntimeSessionSeedSource {
  constructor(
    @Inject(PgConversationV2SessionStore)
    private readonly sessions: PgConversationV2SessionStore,
  ) {}

  async findSeedByAiSessionId(aiSessionId: string): Promise<RuntimeSessionSeed | null> {
    const session = await this.sessions.findByAiSessionId(aiSessionId);
    if (!session) {
      return null;
    }
    return { starterRevisionId: session.starterRevisionId ?? null };
  }
}