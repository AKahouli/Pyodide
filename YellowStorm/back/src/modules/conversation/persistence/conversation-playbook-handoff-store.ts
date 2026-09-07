import type { TrustedConversationPlaybookContextV1 } from '../interfaces/conversation-playbook-handoff.interface';

export const CONVERSATION_PLAYBOOK_HANDOFF_STORE = Symbol('CONVERSATION_PLAYBOOK_HANDOFF_STORE');

export type HandoffStatus = 'prepared' | 'bound' | 'consumed';

export interface ConversationPlaybookHandoffRecord {
  id: string;
  contractVersion: 1;
  handoffId: string;
  ownerId: string;
  sourceConversationId: string;
  targetMessageId: string;
  displayedAnswerVersion: string;
  creationRequestId: string;
  creationRequestFingerprint: string;
  clientBranchSelectionFingerprint: string;
  canonicalPathFingerprint: string;
  contextFingerprint: string;
  canonicalSelectedAnswerIds: string[];
  platformConversationId: string;
  context: TrustedConversationPlaybookContextV1;
  candidateBindings: {
    workspaceIds: string[];
    documentIds: string[];
    connectorIds: string[];
    agentIds: string[];
    skillIds: string[];
  };
  defaultWorkspaceIds: string[];
  status: HandoffStatus;
  boundTurnRequestId?: string;
  boundPromptHash?: string;
  boundUserMessageId?: string;
  assistantRequestId?: string;
  preparedAt: Date;
  boundAt?: Date;
  consumedAt?: Date;
  expiresAt: Date;
}

export type PreparedHandoffInput = Omit<
  ConversationPlaybookHandoffRecord,
  | 'status'
  | 'boundTurnRequestId'
  | 'boundPromptHash'
  | 'boundUserMessageId'
  | 'assistantRequestId'
  | 'boundAt'
  | 'consumedAt'
>;

export interface ConversationPlaybookHandoffStore {
  findByCreationRequest(
    ownerId: string,
    creationRequestId: string,
  ): Promise<ConversationPlaybookHandoffRecord | null>;
  createPrepared(
    input: PreparedHandoffInput,
  ): Promise<{ record: ConversationPlaybookHandoffRecord; created: boolean }>;
  tryBindPrepared(input: {
    handoffId: string;
    ownerId: string;
    platformConversationId: string;
    turnRequestId: string;
    promptHash: string;
    boundAt: Date;
  }): Promise<ConversationPlaybookHandoffRecord | null>;
  findOwned(handoffId: string, ownerId: string): Promise<ConversationPlaybookHandoffRecord | null>;
  attachUserMessageIfBound(
    handoffId: string,
    ownerId: string,
    userMessageId: string,
  ): Promise<void>;
  findForConsumption(input: {
    handoffId: string;
    ownerId: string;
    platformConversationId: string;
    turnRequestId: string;
    userMessageId: string;
  }): Promise<ConversationPlaybookHandoffRecord | null>;
  markConsumedIfBound(id: string, consumedAt: Date): Promise<void>;
}
