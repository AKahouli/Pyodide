
export interface ConversationV2AppShareRecord {
  id: string;
  sessionId: string;
  ownerId: string;
  recipientUserId: string | null;
  recipientEmail: string | null;
  title: string;
  deployedUrl: string;
  lastDeployedAt: Date | null;
  includeConversation: boolean;
  inviteTokenHash: string | null;
  inviteExpiresAt: Date | null;
  inviteConsumedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationV2AppShareUpsert {
  sessionId: string;
  ownerId: string;
  recipientUserId?: string | null;
  recipientEmail?: string | null;
  title: string;
  deployedUrl: string;
  lastDeployedAt?: Date | null;
  includeConversation: boolean;
  inviteTokenHash: string | null;
  inviteExpiresAt: Date | null;
  inviteConsumedAt: Date | null;
}

export interface ConversationV2AppShareStore {
  upsertByRecipientUser(input: ConversationV2AppShareUpsert & { recipientUserId: string }): Promise<ConversationV2AppShareRecord>;
  upsertByRecipientEmail(input: ConversationV2AppShareUpsert & { recipientEmail: string }): Promise<ConversationV2AppShareRecord>;
  listByRecipientUserId(userId: string): Promise<ConversationV2AppShareRecord[]>;
  findConversationAccess(userId: string, sessionId: string): Promise<boolean>;
  deleteForRecipient(userId: string, sessionId: string): Promise<boolean>;
  deleteAllForSession(sessionId: string): Promise<void>;
  findByInviteTokenHash(hash: string): Promise<ConversationV2AppShareRecord | null>;
  markInviteConsumed(id: string): Promise<void>;
  syncDeployMetadata(
    sessionId: string,
    patch: { title: string; deployedUrl: string; lastDeployedAt: Date | null },
  ): Promise<void>;
  claimPendingByEmail(userId: string, email: string): Promise<void>;
}
