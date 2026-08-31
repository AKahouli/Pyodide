import type { EmbeddedMessage, ShareType } from '../interfaces/share.interface';

export const SHARE_STORE = Symbol('SHARE_STORE');

export class ConversationCloneLimitError extends Error {}

export interface ShareSourceConversationRecord {
  id: string;
  title: string;
  messageCount: number;
  runtimeMode?: string;
  lastMessageAt?: Date;
}

export interface SharedConversationRecord {
  id: string;
  originalConversationId: string;
  sharedBy: string;
  shareType: ShareType;
  title: string;
  messages?: EmbeddedMessage[];
  accessToken?: string;
  recipientEmails?: string[];
  forkedConversationIds?: string[];
  expiresAt?: Date;
  viewCount: number;
  isRevoked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ShareStore {
  findSourceConversation(id: string): Promise<ShareSourceConversationRecord | null>;
  listSnapshotMessages(conversationId: string, limit: number): Promise<EmbeddedMessage[]>;
  createPublic(input: {
    originalConversationId: string;
    sharedBy: string;
    title: string;
    messages: EmbeddedMessage[];
    accessToken: string;
    expiresAt: Date;
  }): Promise<SharedConversationRecord>;
  forkConversation(input: {
    original: ShareSourceConversationRecord;
    sharedBy: string;
    maxMessages: number;
  }): Promise<string>;
  deleteForkConversations(ids: string[], ownerId: string): Promise<void>;
  createPrivate(input: {
    originalConversationId: string;
    sharedBy: string;
    title: string;
    recipientEmails: string[];
    forkedConversationIds: string[];
  }): Promise<SharedConversationRecord>;
  listForConversation(conversationId: string): Promise<SharedConversationRecord[]>;
  findById(shareId: string): Promise<SharedConversationRecord | null>;
  markRevoked(shareId: string): Promise<void>;
  findPublicByToken(accessToken: string): Promise<SharedConversationRecord | null>;
  incrementViewCount(shareId: string): Promise<number>;
}
