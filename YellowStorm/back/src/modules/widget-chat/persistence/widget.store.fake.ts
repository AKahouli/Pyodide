import type {
  NewWidgetSession,
  NewWidgetToken,
  WidgetMessageInput,
  WidgetSessionRow,
  WidgetSessionStore,
  WidgetTokenRow,
  WidgetTokenStore,
  WidgetMessageStore,
} from './widget.store';

/** Shared in-memory fakes for the widget store ports (spec use). */

export class InMemoryWidgetTokenStore implements WidgetTokenStore {
  readonly rows: WidgetTokenRow[] = [];

  seed(over: Partial<WidgetTokenRow>): WidgetTokenRow {
    const row = {
      id: over.id ?? Math.random().toString(16).slice(2, 14).padEnd(24, '0'),
      tokenHash: 'hash-1',
      agentId: 'agent-1',
      label: null,
      allowedOrigins: [],
      isActive: true,
      expiresAt: null,
      lastUsedAt: null,
      createdBy: 'user-1',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    };
    this.rows.push(row);
    return row;
  }

  async findActiveByHash(tokenHash: string): Promise<WidgetTokenRow | null> {
    return this.rows.find((r) => r.tokenHash === tokenHash && r.isActive) ?? null;
  }

  async touchLastUsedThrottled(tokenHash: string): Promise<void> {
    const row = this.rows.find((r) => r.tokenHash === tokenHash);
    if (row) row.lastUsedAt = new Date();
  }

  async existsActiveForAgent(agentId: string): Promise<boolean> {
    const now = Date.now();
    return this.rows.some(
      (r) => r.agentId === agentId && r.isActive && (!r.expiresAt || r.expiresAt.getTime() > now),
    );
  }

  async listByAgent(agentId: string): Promise<WidgetTokenRow[]> {
    return this.rows
      .filter((r) => r.agentId === agentId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async insert(row: NewWidgetToken): Promise<WidgetTokenRow> {
    return this.seed({ ...row });
  }

  async update(
    agentId: string,
    tokenId: string,
    patch: Partial<Pick<NewWidgetToken, 'label' | 'allowedOrigins' | 'isActive' | 'expiresAt'>>,
  ): Promise<WidgetTokenRow | null> {
    const row = this.rows.find((r) => r.id === tokenId && r.agentId === agentId);
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: new Date() });
    return row;
  }

  async delete(agentId: string, tokenId: string): Promise<WidgetTokenRow | null> {
    const idx = this.rows.findIndex((r) => r.id === tokenId && r.agentId === agentId);
    if (idx < 0) return null;
    const [row] = this.rows.splice(idx, 1);
    return row;
  }

  async revokeAllForAgent(agentId: string): Promise<void> {
    for (const row of this.rows) {
      if (row.agentId === agentId && row.isActive) {
        row.isActive = false;
        row.updatedAt = new Date();
      }
    }
  }
}

export class InMemoryWidgetSessionStore implements WidgetSessionStore {
  readonly rows: WidgetSessionRow[] = [];

  seed(over: Partial<WidgetSessionRow>): WidgetSessionRow {
    const row = {
      id: over.id ?? Math.random().toString(16).slice(2, 14).padEnd(24, '0'),
      tokenHash: 'hash-1',
      agentId: 'agent-1',
      visitorId: 'visitor-1',
      metadata: {},
      clientContext: {},
      appSource: {},
      geo: {},
      status: 'active',
      messageCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    };
    this.rows.push(row);
    return row;
  }

  async createOrGetSession(row: NewWidgetSession): Promise<{ session: WidgetSessionRow; created: boolean }> {
    const existing = await this.findActive(row.tokenHash, row.visitorId);
    if (existing) return { session: existing, created: false };
    return { session: this.seed({ ...row }), created: true };
  }

  async resetVisitorSession(row: NewWidgetSession): Promise<{ session: WidgetSessionRow; closedSessionIds: string[] }> {
    const closedSessionIds: string[] = [];
    for (const r of this.rows) {
      if (r.tokenHash === row.tokenHash && r.visitorId === row.visitorId && r.status === 'active') {
        r.status = 'closed';
        r.updatedAt = new Date();
        closedSessionIds.push(r.id);
      }
    }
    return { session: this.seed({ ...row }), closedSessionIds };
  }

  async findByIdWithAgent(id: string, tokenHash: string, agentId: string): Promise<WidgetSessionRow | null> {
    return (
      this.rows.find(
        (r) => r.id === id && r.tokenHash === tokenHash && r.agentId === agentId && r.status === 'active',
      ) ?? null
    );
  }

  async incrementMessageCount(id: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) {
      row.messageCount += 1;
      row.updatedAt = new Date();
    }
  }

  private async findActive(tokenHash: string, visitorId: string): Promise<WidgetSessionRow | null> {
    return this.rows.find((r) => r.tokenHash === tokenHash && r.visitorId === visitorId && r.status === 'active') ?? null;
  }
}

export class InMemoryWidgetMessageStore implements WidgetMessageStore {
  readonly rows: Array<WidgetMessageInput & { id: string; createdAt: Date }> = [];

  async insert(input: WidgetMessageInput): Promise<{ id: string }> {
    const id = Math.random().toString(16).slice(2, 14).padEnd(24, '0');
    this.rows.push({ ...input, id, createdAt: new Date() });
    return { id };
  }
}
