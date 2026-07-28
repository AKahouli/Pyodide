export interface CreateConversationData {
  title?: string;
  workspaces?: string[];
  participantEmails?: string[];
  participants?: { email: string; job?: string }[];
  ownerJob?: string;
  projectId?: string;
}

export interface UpdateConversationData {
  title?: string;
  isArchived?: boolean;
  workspaces?: string[];
  isFirstMessage?: boolean;
  taggedAgents?: string[];
  participantEmails?: string[];
  participants?: { email: string; job?: string }[];
  projectId?: string | null;
  skillIds?: string[];
}

export interface ConversationQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: 'lastMessageAt' | 'createdAt' | 'title';
  sortOrder?: 'asc' | 'desc';
  isArchived?: boolean;
  projectId?: string | 'none';
  searchScope?: 'title' | 'fulltext';
}

export interface GroupMember {
  userId: string;
  joinedAt: string;
  status: 'owner' | 'member';
  name?: string;
  email?: string;
  job?: string;
  mentions?: {
    messageId: string;
    seenAt?: string;
  }[];
}

export interface InvitedUser {
  email: string;
  status: 'Confirmed' | 'Guest';
  invitedAt: string;
  job?: string;
}

export interface GroupConversationMeta {
  isGroup: true;
  members: GroupMember[];
  invitedUsers: InvitedUser[];
  taggedAgents?: string[];
}

export interface ConversationResponse {
  id: string;
  title: string;
  createdBy: string;
  ownerName?: string;
  workspaces: string[];
  selectedSkills: string[];
  /** Sticky routing agents: last @mention set; reused when a turn has no tags. */
  taggedAgentIds: string[];
  systemWorkspaceId?: string;
  lastMessageAt?: string;
  messageCount: number;
  isArchived: boolean;
  isShared: boolean;
  sharedFrom?: string;
  createdAt: string;
  updatedAt: string;
  groupMeta?: GroupConversationMeta;
  projectId?: string | null;
  runtimeMode: 'standard' | 'governed';
  governanceContext?: {
    programId: string;
    scopeId: string;
    deploymentId: string;
    revisionId: string;
    revisionNumber: number;
    pinnedAt: string;
    runtimeDefinition: { primaryAgentId: string; allowedAgentIds: string[]; workspaceIds: string[] };
  };
  branchProvenance?: {
    sourceConversationId: string;
    sourceTargetMessageId: string;
    branchedAt: string;
  };
}

export interface PaginatedConversations {
  conversations: ConversationResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}
