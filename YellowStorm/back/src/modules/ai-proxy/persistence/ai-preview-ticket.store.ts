/**
 * Store port for app_runtime.ai_preview_tickets (P8 Mongo cutover).
 */
export const AI_PREVIEW_TICKET_STORE = Symbol('AI_PREVIEW_TICKET_STORE');

export interface AiPreviewTicketRecord {
  id: string;
  ticketHash: string;
  conversationSessionId: string;
  workspaceId: string;
  bindingId: string;
  billableUserId: string;
  purpose: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAiPreviewTicketData {
  ticketHash: string;
  conversationSessionId: string;
  workspaceId: string;
  bindingId: string;
  billableUserId: string;
  purpose?: string;
  expiresAt: Date;
}

export interface AiPreviewTicketStore {
  create(data: CreateAiPreviewTicketData): Promise<AiPreviewTicketRecord>;
  /** Expire all live tickets for the workspace. */
  expireLiveForWorkspace(workspaceId: string): Promise<void>;
  /** Find unexpired ticket by hash and purpose. */
  findLiveByHash(ticketHash: string, purpose: string): Promise<AiPreviewTicketRecord | null>;
}
