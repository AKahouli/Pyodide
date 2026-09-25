/** Store ports for channels.telegram_* (plan 4.7). */
export const TELEGRAM_INTEGRATION_STORE = Symbol('TELEGRAM_INTEGRATION_STORE');
export const TELEGRAM_BINDING_STORE = Symbol('TELEGRAM_BINDING_STORE');
export const TELEGRAM_LINK_CODE_STORE = Symbol('TELEGRAM_LINK_CODE_STORE');
export const TELEGRAM_VALIDATION_STORE = Symbol('TELEGRAM_VALIDATION_STORE');

export interface TelegramIntegrationRow {
  id: string;
  userId: string;
  agentId: string;
  encryptedBotToken: string;
  botUsername: string | null;
  webhookSecret: string;
  enabled: boolean;
  status: string;
  errorMessage: string | null;
  lastWebhookAt: Date | null;
  lastUpdateId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TelegramIntegrationStore {
  findByAgent(agentId: string): Promise<TelegramIntegrationRow | null>;
  findById(id: string): Promise<TelegramIntegrationRow | null>;
  /** Enabled integrations with a stored token (polling + boot webhook sync). */
  listEnabled(): Promise<TelegramIntegrationRow[]>;
  insert(row: {
    userId: string;
    agentId: string;
    encryptedBotToken: string;
    botUsername: string | null;
    webhookSecret: string;
    enabled: boolean;
    status: string;
  }): Promise<TelegramIntegrationRow>;
  update(id: string, patch: Partial<Pick<TelegramIntegrationRow, 'encryptedBotToken' | 'botUsername' | 'enabled' | 'status' | 'errorMessage'>>): Promise<TelegramIntegrationRow | null>;
  /**
   * Webhook dedup (plan 4.7): UPDATE … SET last_update_id, last_webhook_at
   * WHERE id AND (last_update_id IS NULL OR last_update_id < $2). Zero rows
   * means a duplicate update.
   */
  markWebhookUpdate(integrationId: string, updateId: number): Promise<boolean>;
  touchLastWebhook(integrationId: string): Promise<void>;
  /** Bindings + link codes cascade via FK; single DELETE (plan 4.7). */
  delete(id: string): Promise<void>;
}

export interface TelegramBindingRow {
  id: string;
  integrationId: string;
  userId: string;
  agentId: string;
  telegramChatId: string;
  telegramUserId: string | null;
  conversationId: string | null;
  bindingType: string;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TelegramBindingStore {
  findByChat(integrationId: string, telegramChatId: string): Promise<TelegramBindingRow | null>;
  findByConversation(integrationId: string, conversationId: string): Promise<TelegramBindingRow | null>;
  /** Latest owner (member) binding for the integration's user — the approval chat. */
  findOwnerBinding(integrationId: string, userId: string): Promise<TelegramBindingRow | null>;
  /** ON CONFLICT (integration_id, telegram_chat_id) DO UPDATE (plan 4.7). */
  upsert(row: {
    integrationId: string;
    userId: string;
    agentId: string;
    telegramChatId: string;
    telegramUserId: string | null;
    bindingType: string;
    lastMessageAt: Date;
  }): Promise<TelegramBindingRow>;
  updateLastMessage(id: string, lastMessageAt: Date): Promise<void>;
  update(id: string, patch: Partial<Pick<TelegramBindingRow, 'conversationId' | 'telegramUserId'>>): Promise<void>;
  deleteAllForIntegration(integrationId: string): Promise<void>;
}

export interface TelegramLinkCodeRow {
  id: string;
  integrationId: string;
  userId: string;
  agentId: string;
  codeHash: string;
  expiresAt: Date;
  consumed: boolean;
  consumedAt: Date | null;
}

export interface TelegramLinkCodeStore {
  /**
   * Generation (plan 4.7): withTransaction { DELETE unconsumed for
   * integration; INSERT }.
   */
  generate(row: { integrationId: string; userId: string; agentId: string; codeHash: string; expiresAt: Date }): Promise<void>;
  /**
   * Consumption (plan 4.7): UPDATE … SET consumed=true WHERE code_hash AND
   * integration_id AND NOT consumed AND expires_at > now() RETURNING *.
   */
  consume(codeHash: string, integrationId: string): Promise<TelegramLinkCodeRow | null>;
  deleteAllForIntegration(integrationId: string): Promise<void>;
}

export interface TelegramValidationRow {
  id: string;
  integrationId: string;
  agentId: string;
  conversationId: string;
  guestTelegramChatId: string;
  guestLabel: string | null;
  question: string;
  choices: string[];
  status: string;
  answer: string | null;
  answeredAt: Date | null;
  expiresAt: Date;
  ownerMessageId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface TelegramValidationStore {
  insert(row: {
    integrationId: string;
    agentId: string;
    conversationId: string;
    guestTelegramChatId: string;
    guestLabel: string | null;
    question: string;
    choices: string[];
    status: string;
    expiresAt: Date;
  }): Promise<TelegramValidationRow>;
  findById(id: string): Promise<TelegramValidationRow | null>;
  /** Pending, non-expired validations for an integration, newest first. */
  findPendingByIntegration(integrationId: string): Promise<TelegramValidationRow[]>;
  /** Pending, non-expired validation for a conversation, optionally since a time. */
  hasPendingForConversation(integrationId: string, conversationId: string, since?: Date): Promise<boolean>;
  setOwnerMessageId(id: string, ownerMessageId: number): Promise<void>;
  markAnswered(id: string, answer: string): Promise<void>;
  markExpired(id: string): Promise<void>;
}
