/**
 * Store port for app_runtime.tickets (P8 Mongo cutover).
 */
export const RUNTIME_TICKET_STORE = Symbol('RUNTIME_TICKET_STORE');

export interface RuntimeTicketRecord {
  runtimeSessionId: string;
  ticketHash: string;
  bindingId: string;
  workspaceId: string;
  userId: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRuntimeTicketData {
  runtimeSessionId: string;
  ticketHash: string;
  bindingId: string;
  workspaceId: string;
  userId: string;
  expiresAt: Date;
}

export interface RuntimeTicketStore {
  create(data: CreateRuntimeTicketData): Promise<RuntimeTicketRecord>;
  /** Atomic consume: find unexpired + unconsumed ticket by hash, set consumedAt. */
  consumeByHash(ticketHash: string): Promise<RuntimeTicketRecord | null>;
}
