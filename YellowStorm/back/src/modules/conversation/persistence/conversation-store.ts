export const CONVERSATION_STORE = Symbol('CONVERSATION_STORE');

export interface ConversationAccessRecord {
  id: string;
  createdBy: string;
  memberIds: string[];
  invitedEmails: string[];
}

export interface ConversationMemberRecord {
  userId: string;
  joinedAt: Date;
  status: 'owner' | 'member';
  job?: string;
  mentions: Array<{ messageId: string; seenAt?: Date }>;
}

export interface ConversationInviteRecord {
  email: string;
  status: 'Confirmed' | 'Guest';
  invitedAt: Date;
  job?: string;
}

export interface ConversationGovernanceContext {
  programId: string;
  scopeId: string;
  deploymentId: string;
  revisionId: string;
  revisionNumber: number;
  pinnedAt: string;
  runtimeDefinition: {
    primaryAgentId: string;
    allowedAgentIds: string[];
    workspaceIds: string[];
  };
}

export interface ConversationBranchProvenance {
  sourceConversationId: string;
  sourceTargetMessageId: string;
  branchedAt: string;
  branchedBy?: string;
  selectedAnswerIds?: string[];
  requestId?: string;
  requestFingerprint?: string;
}

export interface ConversationRecord {
  id: string;
  runtimeMode: 'standard' | 'governed';
  runtimePurpose: 'chat' | 'platform_copilot';
  pinnedAgentId?: string | null;
  platformCopilotCreationRequestId?: string;
  governedCreationRequestId?: string;
  title: string;
  createdBy: string;
  workspaces: string[];
  selectedSkills: string[];
  taggedAgentIds: string[];
  systemWorkspaceId?: string;
  projectId?: string | null;
  lastMessageAt?: Date;
  messageCount: number;
  isArchived: boolean;
  isShared: boolean;
  sharedFrom?: string;
  initializationStatus: 'ready' | 'pending' | 'seeding' | 'cleanup_pending';
  branchSeedAttemptId?: string;
  branchRequestId?: string;
  branchProvenance?: ConversationBranchProvenance;
  governanceContext?: ConversationGovernanceContext;
  isGroup: boolean;
  members: ConversationMemberRecord[];
  invitedUsers: ConversationInviteRecord[];
  groupTaggedAgentIds: string[];
  isFirstMessage: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateConversationRecord {
  id: string;
  title: string;
  createdBy: string;
  runtimeMode?: ConversationRecord['runtimeMode'];
  runtimePurpose?: ConversationRecord['runtimePurpose'];
  pinnedAgentId?: string;
  platformCopilotCreationRequestId?: string;
  governedCreationRequestId?: string;
  governanceContext?: ConversationGovernanceContext;
  workspaces?: string[];
  selectedSkills?: string[];
  taggedAgentIds?: string[];
  projectId?: string | null;
  members?: ConversationMemberRecord[];
  invitedUsers?: ConversationInviteRecord[];
  isGroup?: boolean;
}

export interface ConversationListInput {
  userId: string;
  page: number;
  limit: number;
  search?: string;
  sortBy: 'lastMessageAt' | 'createdAt' | 'title';
  sortOrder: 'asc' | 'desc';
  isArchived?: boolean;
  projectId?: string;
  searchScope?: string;
  runtimePurpose?: string;
}

export interface ConversationStore {
  create(input: CreateConversationRecord): Promise<ConversationRecord>;
  findById(id: string, includeInitializing?: boolean): Promise<ConversationRecord | null>;
  findByPlatformCreationRequest(ownerId: string, requestId: string): Promise<ConversationRecord | null>;
  findLatestPlatformConversation(ownerId: string, pinnedAgentId: string): Promise<ConversationRecord | null>;
  findByGovernedCreationRequest(ownerId: string, requestId: string): Promise<ConversationRecord | null>;
  list(input: ConversationListInput): Promise<{ records: ConversationRecord[]; total: number }>;
  updateOwned(id: string, ownerId: string, patch: Partial<Pick<ConversationRecord, 'title' | 'isArchived' | 'workspaces' | 'selectedSkills' | 'projectId' | 'isFirstMessage' | 'groupTaggedAgentIds' | 'members' | 'invitedUsers' | 'isGroup'>>): Promise<ConversationRecord | null>;
  deleteOwned(id: string, ownerId: string): Promise<ConversationRecord | null>;
  setSystemWorkspace(id: string, workspaceId: string): Promise<void>;
  joinGroup(id: string, userId: string, email: string, joinedAt: Date): Promise<ConversationRecord | null>;
  removeMember(id: string, memberId: string): Promise<ConversationRecord | null>;
  updateMemberJob(id: string, memberId: string, job: string): Promise<ConversationRecord | null>;
  touchMessage(id: string): Promise<void>;
  addGroupTaggedAgents(id: string, agentIds: string[]): Promise<string[]>;
  replaceTaggedAgentIds(id: string, agentIds: string[]): Promise<void>;
  updateInternal(id: string, patch: { title?: string; isArchived?: boolean; isFirstMessage?: boolean }): Promise<void>;
  getWorkspaceIds(id: string): Promise<{ workspaces: string[]; systemWorkspaceId?: string } | null>;
  findOrphaned(cutoff: Date, limit: number): Promise<ConversationRecord[]>;
  markMentionSeen(conversationId: string, userId: string, messageId: string, seenAt: Date): Promise<void>;
  addMention(conversationId: string, userId: string, messageId: string): Promise<void>;
  findActiveAccessById(id: string): Promise<ConversationAccessRecord | null>;
  countByProject(userId: string, projectId: string): Promise<number>;
  countByProjects(userId: string, projectIds: string[]): Promise<Map<string, number>>;
  detachProject(userId: string, projectId: string): Promise<number>;
  removeWorkspaceFromAll(workspaceId: string): Promise<number>;
}
