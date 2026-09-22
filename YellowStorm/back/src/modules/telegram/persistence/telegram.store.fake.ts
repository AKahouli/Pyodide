import type {
  TelegramBindingRow,
  TelegramBindingStore,
  TelegramIntegrationRow,
  TelegramIntegrationStore,
  TelegramLinkCodeRow,
  TelegramLinkCodeStore,
} from './telegram.store';

/** Shared in-memory fakes for the telegram store ports (spec use). */

export class InMemoryTelegramIntegrationStore implements TelegramIntegrationStore {
  readonly rows: TelegramIntegrationRow[] = [];

  seed(over: Partial<TelegramIntegrationRow>): TelegramIntegrationRow {
    const row = {
      id: over.id ?? Math.random().toString(16).slice(2, 14).padEnd(24, '0'),
      userId: 'user-1',
      agentId: 'agent-1',
      encryptedBotToken: 'encrypted:bot-token',
      botUsername: 'my_agent_bot',
      webhookSecret: 'webhook-secret',
      enabled: true,
      status: 'pending',
      errorMessage: null,
      lastWebhookAt: null,
      lastUpdateId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    };
    this.rows.push(row);
    return row;
  }

  async findByAgent(agentId: string): Promise<TelegramIntegrationRow | null> {
    return this.rows.find((r) => r.agentId === agentId) ?? null;
  }

  async findById(id: string): Promise<TelegramIntegrationRow | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async insert(row: Parameters<TelegramIntegrationStore['insert']>[0]): Promise<TelegramIntegrationRow> {
    return this.seed({ ...row });
  }

  async update(
    id: string,
    patch: Partial<Pick<TelegramIntegrationRow, 'encryptedBotToken' | 'botUsername' | 'enabled' | 'status' | 'errorMessage'>>,
  ): Promise<TelegramIntegrationRow | null> {
    const row = this.rows.find((r) => r.id === id);
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: new Date() });
    return row;
  }

  async markWebhookUpdate(integrationId: string, updateId: number): Promise<boolean> {
    const row = this.rows.find((r) => r.id === integrationId);
    if (!row || (row.lastUpdateId !== null && row.lastUpdateId >= updateId)) return false;
    row.lastUpdateId = updateId;
    row.lastWebhookAt = new Date();
    return true;
  }

  async touchLastWebhook(integrationId: string): Promise<void> {
    const row = this.rows.find((r) => r.id === integrationId);
    if (row) row.lastWebhookAt = new Date();
  }

  async delete(id: string): Promise<void> {
    const idx = this.rows.findIndex((r) => r.id === id);
    if (idx >= 0) this.rows.splice(idx, 1);
  }
}

export class InMemoryTelegramBindingStore implements TelegramBindingStore {
  readonly rows: TelegramBindingRow[] = [];

  seed(over: Partial<TelegramBindingRow>): TelegramBindingRow {
    const row = {
      id: over.id ?? Math.random().toString(16).slice(2, 14).padEnd(24, '0'),
      integrationId: 'integration-1',
      userId: 'user-1',
      agentId: 'agent-1',
      telegramChatId: '42',
      telegramUserId: null,
      conversationId: null,
      lastMessageAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...over,
    };
    this.rows.push(row);
    return row;
  }

  async findByChat(integrationId: string, telegramChatId: string): Promise<TelegramBindingRow | null> {
    return this.rows.find((r) => r.integrationId === integrationId && r.telegramChatId === telegramChatId) ?? null;
  }

  async upsert(row: Parameters<TelegramBindingStore['upsert']>[0]): Promise<TelegramBindingRow> {
    const existing = await this.findByChat(row.integrationId, row.telegramChatId);
    if (existing) {
      Object.assign(existing, {
        userId: row.userId,
        agentId: row.agentId,
        telegramUserId: row.telegramUserId,
        lastMessageAt: row.lastMessageAt,
        updatedAt: new Date(),
      });
      return existing;
    }
    return this.seed({ ...row });
  }

  async updateLastMessage(id: string, lastMessageAt: Date): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) Object.assign(row, { lastMessageAt, updatedAt: new Date() });
  }

  async update(id: string, patch: Partial<Pick<TelegramBindingRow, 'conversationId' | 'telegramUserId'>>): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) Object.assign(row, patch, { updatedAt: new Date() });
  }

  async deleteAllForIntegration(integrationId: string): Promise<void> {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i].integrationId === integrationId) this.rows.splice(i, 1);
    }
  }
}

export class InMemoryTelegramLinkCodeStore implements TelegramLinkCodeStore {
  readonly rows: (TelegramLinkCodeRow & { expired?: boolean })[] = [];

  async generate(row: { integrationId: string; userId: string; agentId: string; codeHash: string; expiresAt: Date }): Promise<void> {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      const r = this.rows[i];
      if (r.integrationId === row.integrationId && !r.consumed) this.rows.splice(i, 1);
    }
    this.rows.push({
      id: Math.random().toString(16).slice(2, 14).padEnd(24, '0'),
      ...row,
      consumed: false,
      consumedAt: null,
    });
  }

  async consume(codeHash: string, integrationId: string): Promise<TelegramLinkCodeRow | null> {
    const row = this.rows.find(
      (r) => r.codeHash === codeHash && r.integrationId === integrationId && !r.consumed && !r.expired,
    );
    if (!row) return null;
    row.consumed = true;
    row.consumedAt = new Date();
    return row;
  }

  async deleteAllForIntegration(integrationId: string): Promise<void> {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i].integrationId === integrationId) this.rows.splice(i, 1);
    }
  }
}
