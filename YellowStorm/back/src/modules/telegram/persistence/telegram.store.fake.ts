import type {
  TelegramBindingRow,
  TelegramBindingStore,
  TelegramIntegrationRow,
  TelegramIntegrationStore,
  TelegramLinkCodeRow,
  TelegramLinkCodeStore,
  TelegramValidationRow,
  TelegramValidationStore,
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

  async listEnabled(): Promise<TelegramIntegrationRow[]> {
    return this.rows.filter((r) => r.enabled && !!r.encryptedBotToken);
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
      bindingType: 'member',
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

  async findByConversation(integrationId: string, conversationId: string): Promise<TelegramBindingRow | null> {
    return this.rows.find((r) => r.integrationId === integrationId && r.conversationId === conversationId) ?? null;
  }

  async findOwnerBinding(integrationId: string, userId: string): Promise<TelegramBindingRow | null> {
    const matches = this.rows.filter(
      (r) => r.integrationId === integrationId && r.userId === userId && r.bindingType === 'member',
    );
    return matches.length ? matches[matches.length - 1] : null;
  }

  async upsert(row: Parameters<TelegramBindingStore['upsert']>[0]): Promise<TelegramBindingRow> {
    const existing = await this.findByChat(row.integrationId, row.telegramChatId);
    if (existing) {
      Object.assign(existing, {
        userId: row.userId,
        agentId: row.agentId,
        telegramUserId: row.telegramUserId,
        bindingType: row.bindingType,
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

export class InMemoryTelegramValidationStore implements TelegramValidationStore {
  readonly rows: TelegramValidationRow[] = [];

  async insert(row: Parameters<TelegramValidationStore['insert']>[0]): Promise<TelegramValidationRow> {
    const created: TelegramValidationRow = {
      id: Math.random().toString(16).slice(2, 14).padEnd(24, '0'),
      ...row,
      answer: null,
      answeredAt: null,
      ownerMessageId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.push(created);
    return created;
  }

  async findById(id: string): Promise<TelegramValidationRow | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }

  async findPendingByIntegration(integrationId: string): Promise<TelegramValidationRow[]> {
    const now = Date.now();
    return this.rows
      .filter((r) => r.integrationId === integrationId && r.status === 'pending' && r.expiresAt.getTime() > now)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async hasPendingForConversation(integrationId: string, conversationId: string, since?: Date): Promise<boolean> {
    const now = Date.now();
    return this.rows.some(
      (r) =>
        r.integrationId === integrationId &&
        r.conversationId === conversationId &&
        r.status === 'pending' &&
        r.expiresAt.getTime() > now &&
        (!since || r.createdAt.getTime() >= since.getTime()),
    );
  }

  async setOwnerMessageId(id: string, ownerMessageId: number): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) Object.assign(row, { ownerMessageId, updatedAt: new Date() });
  }

  async markAnswered(id: string, answer: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) Object.assign(row, { status: 'answered', answer, answeredAt: new Date(), updatedAt: new Date() });
  }

  async markExpired(id: string): Promise<void> {
    const row = this.rows.find((r) => r.id === id);
    if (row) Object.assign(row, { status: 'expired', updatedAt: new Date() });
  }
}
