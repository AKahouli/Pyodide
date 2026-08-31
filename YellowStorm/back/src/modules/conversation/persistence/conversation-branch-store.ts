import type { ConversationRecord } from './conversation-store';
import type { MessageRecord } from './message-store';

export const CONVERSATION_BRANCH_STORE = Symbol('CONVERSATION_BRANCH_STORE');

export interface BranchStateRecord {
  id: string;
  createdBy: string;
  initializationStatus: ConversationRecord['initializationStatus'];
  sourceConversationId: string;
  sourceTargetMessageId: string;
  requestId: string;
  requestFingerprint: string;
}

export interface ConversationBranchStore {
  findByRequest(ownerId: string, requestId: string): Promise<BranchStateRecord | null>;
  createPending(input: {
    source: ConversationRecord;
    path: MessageRecord[];
    selectedAnswerIds: string[];
    requestId: string;
    requestFingerprint: string;
    targetMessageId: string;
    userId: string;
  }): Promise<BranchStateRecord>;
  claimSeed(id: string, attemptId: string): Promise<boolean>;
  finalizeSeed(id: string, attemptId: string): Promise<boolean>;
  ownsSeed(id: string, attemptId: string): Promise<boolean>;
  markCleanup(id: string, attemptId?: string): Promise<boolean>;
  deleteCleanup(id: string): Promise<void>;
  claimStale(cutoff: Date): Promise<BranchStateRecord[]>;
}
