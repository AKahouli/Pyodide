
export interface AppBuilderAppShareRecord {
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

export interface AppBuilderAppShareUpsert {
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

export interface AppBuilderAppShareStore {
  upsertByRecipientUser(input: AppBuilderAppShareUpsert & { recipientUserId: string }): Promise<AppBuilderAppShareRecord>;
  upsertByRecipientEmail(input: AppBuilderAppShareUpsert & { recipientEmail: string }): Promise<AppBuilderAppShareRecord>;
  listByRecipientUserId(userId: string): Promise<AppBuilderAppShareRecord[]>;
  findConversationAccess(userId: string, sessionId: string): Promise<boolean>;
  deleteForRecipient(userId: string, sessionId: string): Promise<boolean>;
  deleteAllForSession(sessionId: string): Promise<void>;
  findByInviteTokenHash(hash: string): Promise<AppBuilderAppShareRecord | null>;
  markInviteConsumed(id: string): Promise<void>;
  syncDeployMetadata(
    sessionId: string,
    patch: { title: string; deployedUrl: string; lastDeployedAt: Date | null },
  ): Promise<void>;
  claimPendingByEmail(userId: string, email: string): Promise<void>;
}
