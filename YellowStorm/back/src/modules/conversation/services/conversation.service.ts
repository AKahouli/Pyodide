import { Inject, Injectable, Optional, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../../user/schemas/user.schema';
import type { AuthUser } from '@common/auth/auth-user';
import type { UserDocument } from '@modules/user/schemas/user.schema';
import {
  CreateConversationData,
  UpdateConversationData,
  ConversationQueryParams,
  ConversationResponse,
  PaginatedConversations,
  GroupConversationMeta,
} from '../interfaces/conversation.interface';
import { LoggerService } from '../../logger';
import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ServiceUnavailableException,
} from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { AgentRepository } from '../../agent/repositories/agent.repository';
import {
  PLATFORM_COPILOT,
  PLATFORM_COPILOT_AGENT_SLUG,
} from '../../agent/constants/platform-copilot.constants';
import { FeatureVisibilityService } from '../../system/feature-visibility.service';
import { WorkspaceService } from '../../workspace/workspace.service';
import { WorkspaceDocumentService } from '../../workspace/workspace-document.service';
import { WorkspaceShareService } from '../../workspace/workspace-share.service';
import { EmailService } from '../../email/email.service';
import {
  DocumentQueryParams,
  PaginatedDocuments,
} from '../../workspace/interfaces/workspace-document.interface';
import {
  CONVERSATION_STORE,
  type ConversationRecord,
  type ConversationStore,
} from '../persistence/conversation-store';
import { newOwnedId } from '../persistence/owned-id';
import { ProjectShareService } from '../../project/project-share.service';
import { PG_POOL } from '../../postgres/postgres.constants';
import type { Pool, PoolClient } from 'pg';

@Injectable()
export class ConversationService {
  private isCleaningUp = false;

  constructor(
    @Inject(CONVERSATION_STORE) private readonly conversationStore: ConversationStore,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly logger: LoggerService,
    private readonly configService: ConfigService,
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceDocumentService: WorkspaceDocumentService,
    private readonly emailService: EmailService,
    private readonly agentRepository: AgentRepository,
    private readonly featureVisibility: FeatureVisibilityService,
    @Inject(forwardRef(() => ProjectShareService))
    private readonly projectShareService: ProjectShareService,
    @Optional() @Inject(PG_POOL) private readonly postgresPool?: Pool,
    @Optional() private readonly workspaceShareService?: WorkspaceShareService,
  ) {
    this.logger.setContext('ConversationService');
  }

  async create(userId: string, data: CreateConversationData): Promise<ConversationResponse> {
    if (data.runtimePurpose === PLATFORM_COPILOT) {
      return this.createOrReusePlatformCopilot(userId, data.creationRequestId);
    }
    if (data.creationRequestId) {
      throw new BadRequestException(
        undefined,
        'creationRequestId is only supported for platform-copilot conversations',
      );
    }
    if (data.projectId) {
      await this.projectShareService.assertProjectWriteAccess(userId, data.projectId);
    }
    const emails =
      data.participants?.map((participant) => participant.email) ?? data.participantEmails;
    const group = await this.buildGroupMetadata(emails, userId, data.participants, data.ownerJob);
    const record = await this.conversationStore.create({
      id: newOwnedId(),
      title: data.title || (group ? 'New Group Conversation' : 'New Conversation'),
      createdBy: userId,
      workspaces: data.workspaces ?? [],
      projectId: data.projectId,
      isGroup: Boolean(group),
      members: group?.members.map((member) => ({
        userId: member.userId,
        joinedAt: new Date(member.joinedAt),
        status: member.status,
        job: member.job,
        mentions: [],
      })),
      invitedUsers: group?.invitedUsers.map((invite) => ({
        ...invite,
        invitedAt: new Date(invite.invitedAt),
      })),
    });
    if (group && emails?.length) await this.sendInitialInvitations(record, emails, userId);
    this.logger.log('Conversation created', { conversationId: record.id, userId });
    return this.mapToResponse(record);
  }

  async assertPlatformCopilotAgent(pinnedAgentId?: string | null): Promise<string> {
    const visibility = await this.featureVisibility.getVisibility();
    if (!visibility.platformCopilot) {
      throw new ServiceUnavailableException(
        ErrorCode.AGENT_UNAVAILABLE,
        'Yellowmind is currently unavailable',
      );
    }
    const activeAgentId = await this.agentRepository.findActiveDefaultIdBySlugAndType(
      PLATFORM_COPILOT_AGENT_SLUG,
      PLATFORM_COPILOT,
    );
    if (!activeAgentId || (pinnedAgentId && pinnedAgentId !== activeAgentId)) {
      throw new ServiceUnavailableException(
        ErrorCode.AGENT_UNAVAILABLE,
        'Yellowmind is currently unavailable',
      );
    }
    return activeAgentId;
  }

  async resolvePlatformCopilotAgent(conversation: {
    id?: string;
    pinnedAgentId?: string | null;
    taggedAgentIds?: string[];
  }): Promise<string> {
    return this.assertPlatformCopilotAgent(conversation.pinnedAgentId);
  }

  private async createOrReusePlatformCopilot(
    userId: string,
    requestedCreationId?: string,
  ): Promise<ConversationResponse> {
    if (requestedCreationId) {
      const requested = await this.conversationStore.findByPlatformCreationRequest(
        userId,
        requestedCreationId,
      );
      if (requested) {
        await this.resolvePlatformCopilotAgent(requested);
        return this.mapToResponse(requested);
      }
    }
    const pinnedAgentId = await this.assertPlatformCopilotAgent();
    if (!requestedCreationId) {
      const existing = await this.conversationStore.findLatestPlatformConversation(
        userId,
        pinnedAgentId,
      );
      if (existing) return this.mapToResponse(existing);
    }
    const requestId = requestedCreationId ?? `initial:${pinnedAgentId}`;
    try {
      return this.mapToResponse(
        await this.conversationStore.create({
          id: newOwnedId(),
          title: 'Yellowmind',
          createdBy: userId,
          runtimePurpose: PLATFORM_COPILOT,
          platformCopilotCreationRequestId: requestId,
          pinnedAgentId,
          taggedAgentIds: [pinnedAgentId],
        }),
      );
    } catch (error: unknown) {
      if (this.isUniqueViolation(error)) {
        const raced = await this.conversationStore.findByPlatformCreationRequest(userId, requestId);
        if (raced) return this.mapToResponse(raced);
      }
      throw error;
    }
  }

  async createGoverned(
    userId: string,
    data: {
      title?: string;
      requestId: string;
      programId: string;
      scopeId: string;
      deploymentId: string;
      revisionId: string;
      revisionNumber: number;
      primaryAgentId: string;
      allowedAgentIds: string[];
      workspaceIds: string[];
    },
  ): Promise<ConversationResponse> {
    const existing = await this.conversationStore.findByGovernedCreationRequest(
      userId,
      data.requestId,
    );
    if (existing) return this.mapToResponse(existing);
    try {
      const record = await this.conversationStore.create({
        id: newOwnedId(),
        title: data.title || 'New Conversation',
        createdBy: userId,
        runtimeMode: 'governed',
        governedCreationRequestId: data.requestId,
        governanceContext: {
          programId: data.programId,
          scopeId: data.scopeId,
          deploymentId: data.deploymentId,
          revisionId: data.revisionId,
          revisionNumber: data.revisionNumber,
          pinnedAt: new Date().toISOString(),
          runtimeDefinition: {
            primaryAgentId: data.primaryAgentId,
            allowedAgentIds: data.allowedAgentIds,
            workspaceIds: data.workspaceIds,
          },
        },
        workspaces: data.workspaceIds,
        taggedAgentIds: [data.primaryAgentId],
      });
      return this.mapToResponse(record);
    } catch (error: unknown) {
      if (this.isUniqueViolation(error)) {
        const raced = await this.conversationStore.findByGovernedCreationRequest(
          userId,
          data.requestId,
        );
        if (raced) return this.mapToResponse(raced);
      }
      throw error;
    }
  }

  async findById(conversationId: string): Promise<ConversationResponse> {
    const record = await this.conversationStore.findById(conversationId);
    if (!record) throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Conversation not found');
    return this.mapToResponse(record);
  }

  async findAllByUser(
    userId: string,
    params: ConversationQueryParams,
  ): Promise<PaginatedConversations | import('../interfaces/conversation.interface').CursorPaginatedConversations> {
    // A project the user can access (own, shared with them, or public) lists
    // every conversation in it, including collaborators' conversations.
    const projectAccessible =
      Boolean(params.projectId) &&
      params.projectId !== 'none' &&
      (await this.projectShareService.hasAccess(userId, params.projectId!));
    if ((params.mode ?? 'legacy') === 'cursor') {
      if (params.page !== undefined) {
        throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'page is not valid in cursor mode');
      }
      const limit = params.limit ?? 50;
      const result = await this.conversationStore.listCursor({
        userId,
        limit,
        cursor: params.cursor,
        search: params.search,
        sortBy: params.sortBy ?? 'lastMessageAt',
        sortOrder: params.sortOrder ?? 'desc',
        isArchived: params.isArchived,
        projectId: params.projectId,
        projectIdUnscoped: projectAccessible,
        searchScope: params.searchScope,
        runtimePurpose: params.runtimePurpose,
      });
      const users = await this.usersById(result.records.map((record) => record.createdBy));
      return {
        conversations: result.records.map((record) => ({
          ...record,
          ownerName: this.userName(users.get(record.createdBy)),
          lastMessageAt: record.lastMessageAt?.toISOString(),
          createdAt: record.createdAt.toISOString(),
          updatedAt: record.updatedAt.toISOString(),
        })),
        pagination: { mode: 'cursor', limit, hasMore: result.hasMore, nextCursor: result.nextCursor },
      };
    }
    if (params.cursor !== undefined) {
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'cursor requires cursor mode');
    }
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const result = await this.conversationStore.list({
      userId,
      page,
      limit,
      search: params.search,
      sortBy: params.sortBy ?? 'lastMessageAt',
      sortOrder: params.sortOrder ?? 'desc',
      isArchived: params.isArchived,
      projectId: params.projectId,
      projectIdUnscoped: projectAccessible,
      searchScope: params.searchScope,
      runtimePurpose: params.runtimePurpose,
    });
    const users = await this.usersById(
      result.records.flatMap((record) => [
        record.createdBy,
        ...record.members.map((member) => member.userId),
      ]),
    );
    return {
      conversations: await Promise.all(
        result.records.map((record) => this.mapToResponse(record, users)),
      ),
      pagination: { page, limit, total: result.total, totalPages: Math.ceil(result.total / limit) },
    };
  }

  async update(
    conversationId: string,
    userId: string,
    data: UpdateConversationData,
  ): Promise<ConversationResponse> {
    const current = await this.requireOwned(conversationId, userId);
    if (data.projectId) {
      await this.projectShareService.assertProjectWriteAccess(userId, data.projectId);
    }
    if (
      current.runtimeMode === 'governed' &&
      [
        data.workspaces,
        data.skillIds,
        data.taggedAgents,
        data.participantEmails,
        data.participants,
      ].some((value) => value !== undefined)
    ) {
      throw new ForbiddenException(
        ErrorCode.CHAT_FORBIDDEN,
        'The approved assistants, knowledge, and participants of a governed conversation cannot be changed',
      );
    }
    let invitedUsers = current.invitedUsers;
    let isGroup = current.isGroup;
    let members: ConversationRecord['members'] | undefined;
    const participantEmails =
      data.participants?.map((participant) => participant.email) ?? data.participantEmails ?? [];
    if (participantEmails.length) {
      const additions = await this.newInvites(
        current,
        participantEmails,
        data.participants,
      );
      invitedUsers = [...invitedUsers, ...additions];
      isGroup = true;
      if (!current.isGroup) {
        members = [
          {
            userId,
            joinedAt: new Date(),
            status: 'owner',
            mentions: [],
          },
        ];
      }
      if (additions.length) {
        const owner = await this.userModel.findById(userId).lean().exec();
        void this.sendGroupInvitations(
          additions.map((invite) => invite.email),
          conversationId,
          current.title,
          this.userName(owner) ?? 'Someone',
        );
      }
    }
    const updated = await this.conversationStore.updateOwned(conversationId, userId, {
      title: data.title,
      isArchived: data.isArchived,
      workspaces: data.workspaces,
      selectedSkills: data.skillIds,
      projectId: data.projectId,
      isFirstMessage: data.isFirstMessage,
      groupTaggedAgentIds: data.taggedAgents,
      members,
      invitedUsers,
      isGroup,
    });
    if (!updated) throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Conversation not found');
    return this.mapToResponse(updated);
  }

  async delete(conversationId: string, userId: string): Promise<void> {
    await this.requireOwned(conversationId, userId);
    // Delete the conversation row first: it references the system workspace
    // (system_workspace_id), so the workspace can only go once nothing points at it.
    const deleted = await this.conversationStore.deleteOwned(conversationId, userId);
    if (!deleted) throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Conversation not found');
    await this.cleanupSystemWorkspace(deleted.systemWorkspaceId);
    this.logger.log('Conversation deleted with cascade', { conversationId, userId });
  }

  async ensureSystemWorkspace(userId: string, conversationId: string): Promise<string> {
    const current = await this.conversationStore.findById(conversationId, true);
    if (!current) throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Conversation not found');
    if (current.systemWorkspaceId) return current.systemWorkspaceId;
    const allocatedStorage = this.configService.get<number>(
      'conversation.systemWorkspaceStorageBytes',
      52428800,
    );
    try {
      const workspace = await this.workspaceService.createSystemWorkspace(
        userId,
        conversationId,
        allocatedStorage,
      );
      await this.conversationStore.setSystemWorkspace(conversationId, workspace.id);
      return workspace.id;
    } catch (error: unknown) {
      const existing = await this.workspaceService.findSystemWorkspace(userId, conversationId);
      if (existing) {
        await this.conversationStore.setSystemWorkspace(conversationId, existing.id);
        return existing.id;
      }
      throw error;
    }
  }

  async joinGroup(conversationId: string, userId: string, email: string) {
    const access = await this.conversationStore.findActiveAccessById(conversationId);
    if (access && (access.createdBy === userId || access.memberIds.includes(userId))) {
      // Owners and existing members already have access; re-entering must not
      // fail with the invite-missing 404.
      return this.findById(conversationId);
    }
    const record = await this.conversationStore.joinGroup(
      conversationId,
      userId,
      email,
      new Date(),
    );
    if (!record) {
      throw new NotFoundException(
        ErrorCode.CHAT_NOT_FOUND,
        'Conversation not found or invitation missing',
      );
    }
    return this.mapToResponse(record);
  }

  async removeMember(conversationId: string, userId: string, memberId: string) {
    const current = await this.requireOwned(conversationId, userId);
    if (!current.isGroup) throw new BadRequestException(undefined, 'Conversation is not a group');
    const updated = await this.conversationStore.removeMember(conversationId, memberId);
    return this.mapToResponse(updated!);
  }

  async updateMemberJob(conversationId: string, userId: string, memberId: string, job: string) {
    const current = await this.requireOwned(conversationId, userId);
    if (!current.isGroup) throw new BadRequestException(undefined, 'Conversation is not a group');
    const updated = await this.conversationStore.updateMemberJob(conversationId, memberId, job);
    if (!updated) throw new NotFoundException(undefined, 'Member not found in conversation');
    return this.mapToResponse(updated);
  }

  async updateLastMessageAt(conversationId: string): Promise<void> {
    await this.conversationStore.touchMessage(conversationId);
  }

  async updateTaggedAgents(conversationId: string, agentIds: string[]): Promise<void> {
    if (agentIds.length)
      await this.conversationStore.addGroupTaggedAgents(conversationId, agentIds);
  }

  async replaceTaggedAgentIds(conversationId: string, agentIds: string[]): Promise<void> {
    await this.conversationStore.replaceTaggedAgentIds(conversationId, agentIds);
  }

  async getGroupMembers(conversationId: string): Promise<Record<string, unknown>[]> {
    const record = await this.conversationStore.findById(conversationId, true);
    if (!record) throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Conversation not found');
    if (!record.isGroup) return [];
    const users = await this.usersById(record.members.map((member) => member.userId));
    return record.members.map((member) => {
      const user = users.get(member.userId);
      return {
        id: member.userId,
        name: this.userName(user),
        email: user?.email,
        role: member.status,
        job: member.job,
        joinedAt: member.joinedAt,
      };
    });
  }

  async getTaggedAgents(conversationId: string): Promise<Record<string, unknown>[]> {
    const record = await this.conversationStore.findById(conversationId, true);
    if (!record) throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Conversation not found');
    if (!record.isGroup) return [];
    return (await this.agentRepository.findByIds(record.groupTaggedAgentIds)).map((agent) => ({
      ...agent,
      id: agent._id,
      _id: undefined,
    }));
  }

  async updateConversationInternal(
    conversationId: string,
    data: UpdateConversationData,
  ): Promise<void> {
    await this.conversationStore.updateInternal(conversationId, {
      title: data.title,
      isArchived: data.isArchived,
      isFirstMessage: data.isFirstMessage,
    });
  }

  async addMessageRef(_conversationId: string, _messageId: string): Promise<void> {}

  async getConversationDocument(conversationId: string): Promise<ConversationRecord> {
    const record = await this.conversationStore.findById(conversationId, true);
    if (!record) throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Conversation not found');
    return record;
  }

  async getWorkspaceDocuments(
    conversationId: string,
    params: DocumentQueryParams,
    userId?: string,
  ): Promise<PaginatedDocuments> {
    const record = await this.conversationStore.findById(conversationId, true);
    if (!record) throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Conversation not found');
    const workspaceIds = await this.filterAccessibleWorkspaceIds(
      userId,
      record.workspaces.filter((id) => id !== record.systemWorkspaceId),
    );
    if (!workspaceIds.length) {
      return {
        documents: [],
        pagination: { page: 1, limit: params.limit || 20, total: 0, totalPages: 0 },
      };
    }
    return this.workspaceDocumentService.findByMultipleWorkspaces(workspaceIds, params);
  }

  async filterAccessibleWorkspaceIds(
    userId: string | undefined,
    workspaceIds: string[],
  ): Promise<string[]> {
    if (!userId) return workspaceIds;
    if (!this.workspaceShareService) return [];
    if (workspaceIds.length === 0) return [];
    return this.workspaceShareService.filterAccessible(userId, workspaceIds);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupOrphanedConversations(): Promise<void> {
    if (this.isCleaningUp) return;
    this.isCleaningUp = true;
    let lockClient: PoolClient | undefined;
    let lockHeld = false;
    let releaseError: Error | undefined;
    try {
      if (this.postgresPool) {
        lockClient = await this.postgresPool.connect();
        const lockResult = await lockClient.query<{ acquired: boolean }>(
          'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
          ['conversation:orphan-cleanup:v1'],
        );
        lockHeld = lockResult.rows[0]?.acquired === true;
        if (!lockHeld) return;
      }
      const hours = this.configService.get<number>(
        'conversation.orphanedConversationThresholdHours',
        24,
      );
      const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
      for (const record of await this.conversationStore.findOrphaned(cutoff, 50)) {
        try {
          const deleted = await this.conversationStore.deleteOwned(record.id, record.createdBy);
          await this.cleanupSystemWorkspace(deleted?.systemWorkspaceId ?? record.systemWorkspaceId);
        } catch (error: unknown) {
          this.logger.warn('Failed to cleanup orphaned conversation', {
            conversationId: record.id,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    } finally {
      if (lockClient) {
        if (lockHeld) {
          try {
            await lockClient.query('SELECT pg_advisory_unlock(hashtext($1))', [
              'conversation:orphan-cleanup:v1',
            ]);
          } catch (error) {
            releaseError = error instanceof Error ? error : new Error('advisory unlock failed');
            this.logger.warn('Failed to release orphan cleanup advisory lock', {
              error: releaseError.message,
            });
          }
        }
        // A client whose unlock failed may still hold the session-level lock:
        // destroy it instead of returning it to the pool.
        lockClient.release(releaseError);
      }
      this.isCleaningUp = false;
    }
  }

  async markMentionSeen(conversationId: string, userId: string, messageId: string) {
    await this.conversationStore.markMentionSeen(conversationId, userId, messageId, new Date());
  }

  async addMention(conversationId: string, userId: string, messageId: string) {
    await this.conversationStore.addMention(conversationId, userId, messageId);
  }

  /** Remove the documents (blobs, vectors) and then the system workspace itself. */
  private async cleanupSystemWorkspace(systemWorkspaceId: string | null | undefined): Promise<void> {
    if (!systemWorkspaceId) return;
    await this.workspaceDocumentService.deleteAllByWorkspace(systemWorkspaceId);
    await this.workspaceService.deleteSystemWorkspace(systemWorkspaceId);
  }

  private async requireOwned(id: string, userId: string): Promise<ConversationRecord> {
    const record = await this.conversationStore.findById(id, true);
    if (!record) throw new NotFoundException(ErrorCode.CHAT_NOT_FOUND, 'Conversation not found');
    if (record.createdBy !== userId) {
      throw new ForbiddenException(
        ErrorCode.CHAT_FORBIDDEN,
        'You do not have access to this conversation',
      );
    }
    return record;
  }

  private async buildGroupMetadata(
    participantEmails: string[] | undefined,
    ownerId: string,
    participants?: { email: string; job?: string }[],
    ownerJob?: string,
  ): Promise<GroupConversationMeta | undefined> {
    if (!participantEmails?.length && !ownerJob) return undefined;
    const emails = participantEmails?.filter(Boolean) ?? [];
    const participantMap = new Map(
      participants?.map((participant) => [participant.email.toLowerCase(), participant.job]),
    );
    const existing = await this.userModel
      .find({ email: { $in: emails } })
      .select('email')
      .lean()
      .exec();
    const registered = new Set(existing.map((user) => user.email.toLowerCase()));
    const now = new Date().toISOString();
    return {
      isGroup: true,
      members: [{ userId: ownerId, joinedAt: now, status: 'owner', job: ownerJob }],
      invitedUsers: emails.map((email) => ({
        email,
        status: registered.has(email.toLowerCase()) ? 'Confirmed' : 'Guest',
        invitedAt: now,
        job: participantMap.get(email.toLowerCase()),
      })),
    };
  }

  private async mapToResponse(
    record: ConversationRecord,
    users?: Map<string, Pick<AuthUser, 'email' | 'profile'>>,
  ): Promise<ConversationResponse> {
    const resolvedUsers =
      users ??
      (await this.usersById(
        record.isGroup
          ? [record.createdBy, ...record.members.map((member) => member.userId)]
          : [record.createdBy],
      ));
    const owner = resolvedUsers.get(record.createdBy);
    const governance = record.governanceContext as ConversationResponse['governanceContext'];
    const provenance = record.branchProvenance
      ? {
          sourceConversationId: record.branchProvenance.sourceConversationId,
          sourceTargetMessageId: record.branchProvenance.sourceTargetMessageId,
          branchedAt: record.branchProvenance.branchedAt,
        }
      : undefined;
    return {
      id: record.id,
      title: record.title,
      createdBy: record.createdBy,
      ownerName: this.userName(owner),
      workspaces: record.workspaces,
      selectedSkills: record.selectedSkills,
      taggedAgentIds: record.taggedAgentIds,
      systemWorkspaceId: record.systemWorkspaceId,
      lastMessageAt: record.lastMessageAt?.toISOString(),
      messageCount: record.messageCount,
      isArchived: record.isArchived,
      isShared: record.isShared,
      sharedFrom: record.sharedFrom,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      groupMeta: record.isGroup
        ? {
            isGroup: true,
            members: record.members.map((member) => {
              const user = resolvedUsers.get(member.userId);
              return {
                userId: member.userId,
                joinedAt: member.joinedAt.toISOString(),
                status: member.status,
                name: this.userName(user),
                email: user?.email,
                job: member.job,
                mentions: member.mentions.map((mention) => ({
                  messageId: mention.messageId,
                  seenAt: mention.seenAt?.toISOString(),
                })),
              };
            }),
            invitedUsers: record.invitedUsers.map((invite) => ({
              ...invite,
              invitedAt: invite.invitedAt.toISOString(),
            })),
            taggedAgents: record.groupTaggedAgentIds,
          }
        : undefined,
      projectId: record.projectId ?? null,
      runtimeMode: record.runtimeMode,
      runtimePurpose: record.runtimePurpose,
      pinnedAgentId: record.pinnedAgentId ?? null,
      governanceContext: governance,
      branchProvenance: provenance,
    };
  }

  private async usersById(
    ids: string[],
  ): Promise<Map<string, Pick<AuthUser, 'email' | 'profile'>>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const users = await this.userModel
      .find({ _id: { $in: unique } })
      .select('email profile')
      .lean()
      .exec();
    return new Map(users.map((user) => [user._id.toString(), user]));
  }

  private userName(
    user?: { email?: string; profile?: { firstName?: string; lastName?: string } } | null,
  ) {
    const fullName = `${user?.profile?.firstName ?? ''} ${user?.profile?.lastName ?? ''}`.trim();
    return fullName || user?.email;
  }

  private async newInvites(
    record: ConversationRecord,
    participantEmails: string[],
    participants?: { email: string; job?: string }[],
  ) {
    const users = await this.usersById(record.members.map((member) => member.userId));
    const occupied = new Set([
      ...record.invitedUsers.map((invite) => invite.email.toLowerCase()),
      ...[...users.values()].map((user) => user.email.toLowerCase()),
    ]);
    const jobs = new Map(
      participants?.map((participant) => [participant.email.toLowerCase(), participant.job]),
    );
    return participantEmails
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email && !occupied.has(email))
      .map((email) => ({
        email,
        status: 'Guest' as const,
        invitedAt: new Date(),
        job: jobs.get(email),
      }));
  }

  private async sendInitialInvitations(
    record: ConversationRecord,
    emails: string[],
    userId: string,
  ) {
    const owner = await this.userModel.findById(userId).lean().exec();
    void this.sendGroupInvitations(
      emails,
      record.id,
      record.title,
      this.userName(owner) ?? 'Someone',
    );
  }

  private async sendGroupInvitations(
    emails: string[],
    conversationId: string,
    title: string,
    invitedBy: string,
  ): Promise<void> {
    const frontendUrl = this.configService.get<string>('app.frontendUrl');
    const conversationUrl = `${frontendUrl}/#/conversation/${conversationId}`;
    await this.emailService.sendBulk({
      emails: emails.map((email) => ({
        to: email,
        subject: `Invitation to group conversation: ${title}`,
        html: `<p><strong>${invitedBy}</strong> invited you to <strong>${title}</strong>.</p><p><a href="${conversationUrl}">Join the conversation</a></p>`,
        text: `${invitedBy} invited you to ${title}. Join here: ${conversationUrl}`,
      })),
      stopOnError: false,
    });
  }

  private isUniqueViolation(error: unknown): boolean {
    return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505');
  }
}
