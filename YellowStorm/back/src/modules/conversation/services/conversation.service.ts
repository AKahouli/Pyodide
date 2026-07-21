import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Conversation, ConversationDocument } from '../schemas/conversation.schema';
import { Message, MessageDocument } from '../schemas/message.schema';
import { SharedConversation, SharedConversationDocument } from '../schemas/shared-conversation.schema';
import { User, UserDocument } from '../../user/schemas/user.schema';
import {
  CreateConversationData,
  UpdateConversationData,
  ConversationQueryParams,
  ConversationResponse,
  PaginatedConversations,
  GroupConversationMeta,
} from '../interfaces/conversation.interface';
import { LoggerService } from '../../logger';
import { NotFoundException, ForbiddenException, BadRequestException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { WorkspaceService } from '../../workspace/workspace.service';
import { WorkspaceDocumentService } from '../../workspace/workspace-document.service';
import { MessageService } from './message.service';
import { EmailService } from '../../email/email.service';
import { DocumentQueryParams, PaginatedDocuments } from '../../workspace/interfaces/workspace-document.interface';
import { escapeRegex } from '../../../common/utils';

@Injectable()
export class ConversationService {
  private isCleaningUp = false;

  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDocument>,
    @InjectModel(SharedConversation.name)
    private readonly sharedConversationModel: Model<SharedConversationDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly logger: LoggerService,
    private readonly configService: ConfigService,
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceDocumentService: WorkspaceDocumentService,
    @Inject(forwardRef(() => MessageService))
    private readonly messageService: MessageService,
    private readonly emailService: EmailService,
  ) {
    this.logger.setContext('ConversationService');
  }

  async create(
    userId: string,
    data: CreateConversationData,
  ): Promise<ConversationResponse> {

    let groupMeta: GroupConversationMeta | undefined;
    const emailsToInvite = data.participants?.map(p => p.email) || data.participantEmails;
    
    if (emailsToInvite?.length) {
      groupMeta = await this.buildGroupMetadata(emailsToInvite, userId, data.participants, data.ownerJob);
    }

    const conversation = await this.conversationModel.create({
      title: data.title || (groupMeta ? 'New Group Conversation' : 'New Conversation'),
      createdBy: new Types.ObjectId(userId),
      workspaces: data.workspaces?.map((id) => new Types.ObjectId(id)) || [],
      messages: [],
      messageCount: 0,
      isArchived: false,
      isShared: false,
      ...(groupMeta ? { groupMeta } : {}),
      ...(data.projectId ? { projectId: new Types.ObjectId(data.projectId) } : {}),
    });

    this.logger.log('Conversation created', {
      conversationId: conversation._id,
      userId,
    });

    if (groupMeta) {
      const owner = await this.userModel.findById(userId).lean().exec();
      const ownerName = owner?.profile ? `${owner.profile.firstName} ${owner.profile.lastName}` : owner?.email;

      this.sendGroupInvitations(
        emailsToInvite!,
        conversation._id.toString(),
        conversation.title,
        ownerName || 'Someone',
      ).catch(err => {
        this.logger.error('Failed to send group invitations', {
          conversationId: conversation._id,
          error: err.message,
        });
      });
    }
 
    return this.findById(conversation._id.toString());
  }

  async createGoverned(userId: string, data: {
    title: string;
    requestId: string;
    programId: string;
    scopeId: string;
    deploymentId: string;
    revisionId: string;
    revisionNumber: number;
    primaryAgentId: string;
    allowedAgentIds: string[];
    workspaceIds: string[];
  }): Promise<ConversationResponse> {
    const existing = await this.conversationModel.findOne({ createdBy: new Types.ObjectId(userId), governedCreationRequestId: data.requestId }).lean().exec();
    if (existing) return this.mapToResponse(existing);
    try {
      const conversation = await this.conversationModel.create({
        title: data.title,
        createdBy: new Types.ObjectId(userId),
        runtimeMode: 'governed',
        governedCreationRequestId: data.requestId,
        governanceContext: {
          programId: new Types.ObjectId(data.programId),
          scopeId: new Types.ObjectId(data.scopeId),
          deploymentId: new Types.ObjectId(data.deploymentId),
          revisionId: new Types.ObjectId(data.revisionId),
          revisionNumber: data.revisionNumber,
          pinnedAt: new Date(),
          runtimeDefinition: { primaryAgentId: data.primaryAgentId, allowedAgentIds: data.allowedAgentIds, workspaceIds: data.workspaceIds },
        },
        workspaces: data.workspaceIds.map((id) => new Types.ObjectId(id)),
        taggedAgentIds: [new Types.ObjectId(data.primaryAgentId)],
        messages: [],
        messageCount: 0,
        isArchived: false,
        isShared: false,
      });
      this.logger.log('Governed conversation created', { conversationId: conversation._id.toString(), userId, scopeId: data.scopeId, revisionId: data.revisionId });
      return this.mapToResponse(conversation);
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: number }).code === 11000) {
        const raced = await this.conversationModel.findOne({ createdBy: new Types.ObjectId(userId), governedCreationRequestId: data.requestId }).lean().exec();
        if (raced) return this.mapToResponse(raced);
      }
      throw error;
    }
  }

  async findById(conversationId: string): Promise<ConversationResponse> {
    const conversation = await this.conversationModel
      .findById(conversationId)
      .lean()
      .exec();

    if (!conversation) {
      throw new NotFoundException(
        ErrorCode.CHAT_NOT_FOUND,
        'Conversation not found',
      );
    }

    if (conversation.groupMeta?.isGroup) {
      await this.conversationModel.populate(conversation, [
        { path: 'createdBy', select: 'profile email' },
        { path: 'groupMeta.members.userId', select: 'profile email' },
      ]);
    }

    return this.mapToResponse(conversation);
  }

  async findAllByUser(
    userId: string,
    params: ConversationQueryParams,
  ): Promise<PaginatedConversations> {
    const {
      page = 1,
      limit = 20,
      search,
      sortBy = 'lastMessageAt',
      sortOrder = 'desc',
      isArchived,
      projectId,
      searchScope,
    } = params;

    const skip = (page - 1) * limit;

    const query: Record<string, unknown> = {
      $or: [
        { createdBy: new Types.ObjectId(userId) },
        { 'groupMeta.members.userId': new Types.ObjectId(userId) },
      ],
    };

    if (isArchived !== undefined) {
      query.isArchived = isArchived;
    }

    if (projectId === 'none') {
      query.projectId = { $in: [null, undefined] };
    } else if (projectId) {
      query.projectId = new Types.ObjectId(projectId);
    }

    if (search) {
      const escaped = escapeRegex(search);
      if (searchScope === 'fulltext') {
        // Match by title OR by message content of conversations the user can see
        const matchingConvIds = await this.messageModel.distinct('conversationId', {
          content: { $regex: escaped, $options: 'i' },
        });

        query.$and = [
          {
            $or: [
              { title: { $regex: escaped, $options: 'i' } },
              { _id: { $in: matchingConvIds } },
            ],
          },
        ];
      } else {
        query.title = { $regex: escaped, $options: 'i' };
      }
    }

    const sort: Record<string, 1 | -1> = {
      [sortBy]: sortOrder === 'asc' ? 1 : -1,
    };

    const [conversations, total] = await Promise.all([
      this.conversationModel.find(query).sort(sort).skip(skip).limit(limit).lean().exec(),
      this.conversationModel.countDocuments(query),
    ]);

    return {
      conversations: conversations.map((c) => this.mapToResponse(c)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async update(
    conversationId: string,
    userId: string,
    data: UpdateConversationData,
  ): Promise<ConversationResponse> {
    const conversation = await this.conversationModel.findById(conversationId);

    if (!conversation) {
      throw new NotFoundException(
        ErrorCode.CHAT_NOT_FOUND,
        'Conversation not found',
      );
    }

    if (conversation.createdBy.toString() !== userId) {
      throw new ForbiddenException(
        ErrorCode.CHAT_FORBIDDEN,
        'You do not have access to this conversation',
      );
    }

    if (conversation.runtimeMode === 'governed' && (data.workspaces !== undefined || data.skillIds !== undefined || data.taggedAgents !== undefined || data.participantEmails !== undefined || data.participants !== undefined)) {
      throw new ForbiddenException(ErrorCode.CHAT_FORBIDDEN, 'The approved assistants, knowledge, and participants of a governed conversation cannot be changed');
    }

    if (data.title !== undefined) {
      conversation.title = data.title;
    }

    if (data.isArchived !== undefined) {
      conversation.isArchived = data.isArchived;
    }

    if (data.workspaces !== undefined) {
      conversation.workspaces = data.workspaces.map((id) => new Types.ObjectId(id));
    }

    if (data.skillIds !== undefined) {
      conversation.selectedSkills = data.skillIds.map((id) => new Types.ObjectId(id));
    }

    if (data.projectId !== undefined) {
      conversation.projectId = data.projectId ? new Types.ObjectId(data.projectId) : null;
    }

    if (data.isFirstMessage !== undefined) {
      conversation.isFirstMessage = data.isFirstMessage;
    }

    if (data.taggedAgents !== undefined) {
      if (!conversation.groupMeta) {
        conversation.groupMeta = {
          isGroup: false,
          members: [
            {
              userId: new Types.ObjectId(userId),
              joinedAt: new Date(),
              status: 'owner',
            },
          ],
          invitedUsers: [],
        };
      }
      conversation.groupMeta.taggedAgents = data.taggedAgents.map((id) => new Types.ObjectId(id));
    }

    // Handle new participant invitations
    if ((data.participantEmails && data.participantEmails.length > 0) || (data.participants && data.participants.length > 0)) {
      await this.handleGroupInvitations(conversation, data.participantEmails || [], userId, data.participants);
    }

    await conversation.save();

    this.logger.log('Conversation updated', {
      conversationId: conversation._id,
      userId,
    });

    return this.mapToResponse(conversation);
  }

  async delete(conversationId: string, userId: string): Promise<void> {
    const conversation = await this.conversationModel.findById(conversationId);

    if (!conversation) {
      throw new NotFoundException(
        ErrorCode.CHAT_NOT_FOUND,
        'Conversation not found',
      );
    }

    if (conversation.createdBy.toString() !== userId) {
      throw new ForbiddenException(
        ErrorCode.CHAT_FORBIDDEN,
        'You do not have access to this conversation',
      );
    }

    // 1. Delete all messages
    const deletedMessages = await this.messageService.deleteByConversation(conversationId);

    // 2. Delete shared conversations referencing this conversation
    await this.sharedConversationModel.deleteMany({
      originalConversationId: new Types.ObjectId(conversationId),
    });

    // 3. Delete system workspace (documents + blobs + workspace record)
    if (conversation.systemWorkspaceId) {
      const wsId = conversation.systemWorkspaceId.toString();
      await this.workspaceDocumentService.deleteAllByWorkspace(wsId);
      await this.workspaceService.deleteSystemWorkspace(wsId);
    }

    // 4. Delete conversation record
    await this.conversationModel.deleteOne({ _id: conversationId });

    this.logger.log('Conversation deleted with cascade', {
      conversationId,
      userId,
      deletedMessages,
      hadSystemWorkspace: !!conversation.systemWorkspaceId,
    });
  }

  async ensureSystemWorkspace(
    userId: string,
    conversationId: string,
  ): Promise<string> {
    const conversation = await this.conversationModel.findById(conversationId);

    if (!conversation) {
      throw new NotFoundException(
        ErrorCode.CHAT_NOT_FOUND,
        'Conversation not found',
      );
    }

    if (conversation.systemWorkspaceId) {
      return conversation.systemWorkspaceId.toString();
    }

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

      conversation.systemWorkspaceId = new Types.ObjectId(workspace.id);
      await conversation.save();

      this.logger.log('System workspace created for conversation', {
        conversationId,
        workspaceId: workspace.id,
      });

      return workspace.id;
    } catch (err: any) {
      // Handle race condition: another concurrent request already created the workspace
      if (err?.code === 11000) {
        this.logger.log('System workspace race condition, fetching existing', {
          conversationId,
        });
        const refreshed = await this.conversationModel.findById(conversationId);
        if (refreshed?.systemWorkspaceId) {
          return refreshed.systemWorkspaceId.toString();
        }
        // Workspace was created but not yet linked — look it up by name
        const existing = await this.workspaceService.findSystemWorkspace(
          userId,
          conversationId,
        );
        if (existing) {
          await this.conversationModel.findByIdAndUpdate(conversationId, {
            systemWorkspaceId: new Types.ObjectId(existing.id),
          });
          return existing.id;
        }
      }
      throw err;
    }
  }

  async joinGroup(conversationId: string, userId: string, email: string): Promise<ConversationResponse> {
    const conversationData = await this.conversationModel.findOne({
      _id: new Types.ObjectId(conversationId),
      'groupMeta.isGroup': true,
      'groupMeta.invitedUsers.email': email.toLowerCase(),
    }).lean().exec();

    if (!conversationData) {
      throw new NotFoundException(
        ErrorCode.CHAT_NOT_FOUND,
        'Conversation not found or invitation missing',
      );
    }

    const invitedUser = conversationData.groupMeta?.invitedUsers.find(
      u => u.email.toLowerCase() === email.toLowerCase()
    );

    const updated = await this.conversationModel.findOneAndUpdate(
      {
        _id: new Types.ObjectId(conversationId),
        'groupMeta.isGroup': true,
        'groupMeta.invitedUsers.email': email.toLowerCase(),
        'groupMeta.members.userId': { $ne: new Types.ObjectId(userId) },
      },
      {
        $pull: { 'groupMeta.invitedUsers': { email: email.toLowerCase() } },
        $push: {
          'groupMeta.members': {
            userId: new Types.ObjectId(userId),
            joinedAt: new Date(),
            status: 'member',
            job: invitedUser?.job,
          },
        },
        $set: { lastMessageAt: new Date() },
      },
      { new: true }
    ).populate('createdBy', 'profile email').lean().exec();

    this.logger.log('User joined group conversation', {
      conversationId,
      userId,
      job: invitedUser?.job,
    });

    if (!updated) {
       // User might already be a member
       return this.findById(conversationId);
    }

    return this.mapToResponse(updated);
  }

  async removeMember(conversationId: string, userId: string, memberId: string): Promise<ConversationResponse> {
    const conversation = await this.conversationModel.findById(conversationId);

    if (!conversation) {
      throw new NotFoundException(
        ErrorCode.CHAT_NOT_FOUND,
        'Conversation not found',
      );
    }

    if (conversation.createdBy.toString() !== userId) {
      throw new ForbiddenException(
        ErrorCode.CHAT_FORBIDDEN,
        'Only the owner can remove members',
      );
    }

    if (!conversation.groupMeta?.isGroup) {
      throw new BadRequestException(
        undefined,
        'Conversation is not a group',
      );
    }

    const updated = await this.conversationModel.findOneAndUpdate(
      { _id: new Types.ObjectId(conversationId) },
      {
        $pull: {
          'groupMeta.members': { userId: new Types.ObjectId(memberId) }
        }
      },
      { new: true }
    ).populate('createdBy', 'profile email').lean().exec();

    this.logger.log('User removed from group conversation', {
      conversationId,
      userId,
      removedMemberId: memberId,
    });

    return this.mapToResponse(updated);
  }

  async updateMemberJob(conversationId: string, userId: string, memberId: string, job: string): Promise<ConversationResponse> {
    const conversation = await this.conversationModel.findById(conversationId);

    if (!conversation) {
      throw new NotFoundException(
        ErrorCode.CHAT_NOT_FOUND,
        'Conversation not found',
      );
    }

    if (conversation.createdBy.toString() !== userId) {
      throw new ForbiddenException(
        ErrorCode.CHAT_FORBIDDEN,
        'Only the owner can update member roles',
      );
    }

    if (!conversation.groupMeta?.isGroup) {
      throw new BadRequestException(
        undefined,
        'Conversation is not a group',
      );
    }

    const updated = await this.conversationModel.findOneAndUpdate(
      { 
        _id: new Types.ObjectId(conversationId),
        'groupMeta.members.userId': new Types.ObjectId(memberId)
      },
      {
        $set: {
          'groupMeta.members.$.job': job
        }
      },
      { new: true }
    ).populate('createdBy', 'profile email').lean().exec();

    if (!updated) {
      throw new NotFoundException(undefined, 'Member not found in conversation');
    }

    return this.mapToResponse(updated);
  }

  async updateLastMessageAt(conversationId: string): Promise<void> {
    await this.conversationModel.findByIdAndUpdate(conversationId, {
      lastMessageAt: new Date(),
      $inc: { messageCount: 1 },
    });
  }

  async updateTaggedAgents(conversationId: string, agentIds: string[]): Promise<void> {
    if (!agentIds || agentIds.length === 0) return;

    const conversation = await this.conversationModel.findById(conversationId);
    if (!conversation || !conversation.groupMeta?.isGroup) return;

    const existingAgentIds = new Set(
      conversation.groupMeta.taggedAgents?.map((id) => id.toString()) || []
    );

    const newAgentIds = agentIds.filter((id) => !existingAgentIds.has(id));

    if (newAgentIds.length > 0) {
      await this.conversationModel.findByIdAndUpdate(conversationId, {
        $addToSet: {
          'groupMeta.taggedAgents': {
            $each: newAgentIds.map((id) => new Types.ObjectId(id)),
          },
        },
      });
      this.logger.log('Persistent tagged agents updated for group conversation', {
        conversationId,
        newAgentIds,
      });
    }
  }

  /**
   * Replaces conversation sticky routing agents with the latest @mention set.
   * Call only when the user tagged agents on the current turn (full replace, not merge).
   */
  async replaceTaggedAgentIds(conversationId: string, agentIds: string[]): Promise<void> {
    if (!agentIds.length) {
      return;
    }

    await this.conversationModel.findByIdAndUpdate(conversationId, {
      $set: {
        taggedAgentIds: agentIds.map((id) => new Types.ObjectId(id)),
      },
    });
  }

  async getGroupMembers(conversationId: string): Promise<any[]> {
    const conversation = await this.conversationModel
      .findById(conversationId)
      .select('groupMeta.members groupMeta.isGroup')
      .populate('groupMeta.members.userId')
      .lean()
      .exec();

    if (!conversation) {
      throw new NotFoundException(
        ErrorCode.CHAT_NOT_FOUND,
        'Conversation not found',
      );
    }

    if (!conversation.groupMeta?.isGroup) {
      return [];
    }

    return conversation.groupMeta.members.map((m: any) => {
      const user = m.userId || {};
      let name = '';
      if (user?.profile) {
        name = `${user.profile.firstName || ''} ${user.profile.lastName || ''}`.trim();
      } else if (user?.email) {
        name = user.email.split('@')[0];
      }

      return {
        ...user,
        id: user?._id?.toString() || m.userId?.toString(),
        name,
        email: user?.email,
        role: m.status, // 'owner' or 'member'
        job: m.job,
        joinedAt: m.joinedAt,
      };
    });
  }

  async getTaggedAgents(conversationId: string): Promise<any[]> {
    const conversation = await this.conversationModel
      .findById(conversationId)
      .select('groupMeta.taggedAgents groupMeta.isGroup')
      .populate('groupMeta.taggedAgents')
      .lean()
      .exec();

    if (!conversation) {
      throw new NotFoundException(
        ErrorCode.CHAT_NOT_FOUND,
        'Conversation not found',
      );
    }

    if (!conversation.groupMeta?.isGroup) {
      return [];
    }

    return (conversation.groupMeta.taggedAgents || []).map((agent: any) => {
      if (agent && typeof agent === 'object') {
        // Handle MongoDB _id to id mapping if needed, similar to Agent schema JSON transform
        const ret = { ...agent, id: agent._id?.toString() || agent.id };
        delete ret._id;
        delete ret.__v;
        return ret;
      }
      return agent;
    });
  }

  /**
   * Internal method to update conversation without ownership check.
   * Used by system services like StreamService for name generation.
   */
  async updateConversationInternal(
    conversationId: string,
    data: UpdateConversationData,
  ): Promise<void> {
    const updateData: Record<string, unknown> = {};
    if (data.title !== undefined) updateData.title = data.title;
    if (data.isArchived !== undefined) updateData.isArchived = data.isArchived;
    if (data.isFirstMessage !== undefined) updateData.isFirstMessage = data.isFirstMessage;

    await this.conversationModel.findByIdAndUpdate(conversationId, updateData);
  }

  async addMessageRef(conversationId: string, messageId: string): Promise<void> {
    await this.conversationModel.findByIdAndUpdate(conversationId, {
      $push: { messages: new Types.ObjectId(messageId) },
    });
  }

  async getConversationDocument(conversationId: string): Promise<ConversationDocument> {
    const conversation = await this.conversationModel.findById(conversationId);

    if (!conversation) {
      throw new NotFoundException(
        ErrorCode.CHAT_NOT_FOUND,
        'Conversation not found',
      );
    }

    return conversation;
  }

  async getWorkspaceDocuments(
    conversationId: string,
    params: DocumentQueryParams,
  ): Promise<PaginatedDocuments> {
    const conversation = await this.conversationModel.findById(conversationId).lean().exec();

    if (!conversation) {
      throw new NotFoundException(
        ErrorCode.CHAT_NOT_FOUND,
        'Conversation not found',
      );
    }

    const workspaceIds = (conversation.workspaces || [])
      .map((w) => w.toString())
      .filter((id) => id !== conversation.systemWorkspaceId?.toString());

    if (workspaceIds.length === 0) {
      return {
        documents: [],
        pagination: {
          page: 1,
          limit: params.limit || 20,
          total: 0,
          totalPages: 0,
        },
      };
    }

    return this.workspaceDocumentService.findByMultipleWorkspaces(workspaceIds, params);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async cleanupOrphanedConversations(): Promise<void> {
    if (this.isCleaningUp) return;
    this.isCleaningUp = true;
    const startTime = Date.now();

    try {
      const thresholdHours = this.configService.get<number>(
        'conversation.orphanedConversationThresholdHours',
        24,
      );
      const cutoff = new Date(Date.now() - thresholdHours * 60 * 60 * 1000);

      const orphaned = await this.conversationModel
        .find({
          messageCount: 0,
          isFirstMessage: true,
          isShared: false,
          createdAt: { $lt: cutoff },
        })
        .limit(50);

      if (orphaned.length === 0) return;

      this.logger.log('Starting orphaned conversation cleanup', {
        count: orphaned.length,
        thresholdHours,
      });

      let cleaned = 0;
      let failed = 0;

      for (const conversation of orphaned) {
        try {
          // Delete messages (safety — should be 0)
          await this.messageService.deleteByConversation(
            conversation._id.toString(),
          );

          // Delete system workspace + documents + blobs
          if (conversation.systemWorkspaceId) {
            const wsId = conversation.systemWorkspaceId.toString();
            await this.workspaceDocumentService.deleteAllByWorkspace(wsId);
            await this.workspaceService.deleteSystemWorkspace(wsId);
          }

          // Delete conversation record
          await this.conversationModel.deleteOne({ _id: conversation._id });
          cleaned++;
        } catch (err) {
          failed++;
          this.logger.warn('Failed to cleanup orphaned conversation', {
            conversationId: conversation._id,
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      }

      this.logger.log('Orphaned conversation cleanup completed', {
        cleaned,
        failed,
        durationMs: Date.now() - startTime,
      });
    } catch (err) {
      this.logger.error('Orphaned conversation cleanup failed', {
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      this.isCleaningUp = false;
    }
  }


  private async buildGroupMetadata(
    participantEmails: string[] | undefined,
    ownerId: string,
    participants?: { email: string; job?: string }[],
    ownerJob?: string,
  ): Promise<GroupConversationMeta | undefined> {
    if (!participantEmails?.length && !ownerJob) {
      return undefined;
    }

    const filteredEmails = participantEmails?.filter(Boolean) || [];
    const participantMap = new Map(participants?.map(p => [p.email.toLowerCase(), p.job]));

    // Efficiently identify which invited emails already correspond to registered users
    const existingUsers = await this.userModel
      .find({ email: { $in: filteredEmails } })
      .select('_id email')
      .lean()
      .exec();

    const registeredEmailSet = new Set(existingUsers.map((u) => u.email));
    const now = new Date();

    return {
      isGroup: true,
      members: [
        {
          userId: ownerId,
          joinedAt: now.toISOString(),
          status: 'owner',
          job: ownerJob,
        },
      ],
      invitedUsers: filteredEmails.map((email) => ({
        email,
        status: registeredEmailSet.has(email) ? 'Confirmed' : 'Guest',
        invitedAt: now.toISOString(),
        job: participantMap.get(email.toLowerCase()),
      })),
    };
  }

  async markMentionSeen(conversationId: string, userId: string, messageId: string): Promise<void> {
    await this.conversationModel.updateOne(
      {
        _id: new Types.ObjectId(conversationId),
        'groupMeta.members.userId': new Types.ObjectId(userId),
        'groupMeta.members.mentions.messageId': new Types.ObjectId(messageId),
      },
      {
        $set: {
          'groupMeta.members.$[member].mentions.$[mention].seenAt': new Date(),
        },
      },
      {
        arrayFilters: [
          { 'member.userId': new Types.ObjectId(userId) },
          { 'mention.messageId': new Types.ObjectId(messageId) },
        ],
      },
    );
  }

  async addMention(conversationId: string, userId: string, messageId: string): Promise<void> {
    await this.conversationModel.updateOne(
      {
        _id: new Types.ObjectId(conversationId),
        'groupMeta.members.userId': new Types.ObjectId(userId),
      },
      {
        $push: {
          'groupMeta.members.$.mentions': {
            messageId: new Types.ObjectId(messageId),
          },
        },
      },
    );
  }

  private mapToResponse(conversation: any): ConversationResponse {
    const toStr = (v: any) => v?.toString?.() ?? v;
    const toISO = (v: any) => (v instanceof Date ? v.toISOString() : v);
 
    const rawGroupMeta = conversation.groupMeta;
    const groupMeta: GroupConversationMeta | undefined = (rawGroupMeta && rawGroupMeta.isGroup)
      ? {
        isGroup: true,
        members:
          rawGroupMeta.members?.map((m: any) => {
            const memberUser = m.userId && typeof m.userId === 'object' ? m.userId : null;
            let name: string | undefined;
            let email: string | undefined;

            if (memberUser) {
              email = memberUser.email;
              if (memberUser.profile?.firstName) {
                name = `${memberUser.profile.firstName} ${memberUser.profile.lastName || ''}`.trim();
              }
            }

            return {
              userId: toStr(m.userId?._id || m.userId),
              joinedAt: toISO(m.joinedAt),
              status: m.status,
              name: name || (email ? email.split('@')[0] : undefined),
              email,
              job: m.job,
              mentions: m.mentions?.map((mn: any) => ({
                messageId: toStr(mn.messageId),
                seenAt: toISO(mn.seenAt),
              })),
            };
          }) || [],
        invitedUsers:
          rawGroupMeta.invitedUsers?.map((u: any) => ({
            email: u.email,
            status: u.status,
            invitedAt: toISO(u.invitedAt),
            job: u.job,
          })) || [],
        taggedAgents: rawGroupMeta.taggedAgents?.map((id: any) => toStr(id)) || [],
      }
      : undefined;
    let ownerName: string | undefined;
    // Check if createdBy is populated (has profile or email)
    if (conversation.createdBy && typeof conversation.createdBy === 'object') {
      const creator = conversation.createdBy as any;
      if (creator.profile?.firstName) {
        ownerName = `${creator.profile.firstName} ${creator.profile.lastName || ''}`.trim();
      } else if (creator.email) {
        ownerName = creator.email;
      }
    }

    return {
      id: toStr(conversation._id),
      title: conversation.title,
      createdBy: toStr(conversation.createdBy?._id || conversation.createdBy),
      ownerName,
      workspaces: conversation.workspaces?.map((w: any) => toStr(w)) || [],
      selectedSkills: conversation.selectedSkills?.map((s: any) => toStr(s)) || [],
      taggedAgentIds: conversation.taggedAgentIds?.map((id: any) => toStr(id)) || [],
      systemWorkspaceId: toStr(conversation.systemWorkspaceId),
      lastMessageAt: toISO(conversation.lastMessageAt),
      messageCount: conversation.messageCount,
      isArchived: conversation.isArchived,
      isShared: conversation.isShared,
      sharedFrom: toStr(conversation.sharedFrom),
      createdAt: toISO(conversation.createdAt),
      updatedAt: toISO(conversation.updatedAt),
      groupMeta,
      projectId: conversation.projectId ? toStr(conversation.projectId) : null,
      runtimeMode: conversation.runtimeMode ?? 'standard',
      governanceContext: conversation.governanceContext ? {
        programId: toStr(conversation.governanceContext.programId),
        scopeId: toStr(conversation.governanceContext.scopeId),
        deploymentId: toStr(conversation.governanceContext.deploymentId),
        revisionId: toStr(conversation.governanceContext.revisionId),
        revisionNumber: conversation.governanceContext.revisionNumber,
        pinnedAt: toISO(conversation.governanceContext.pinnedAt),
        runtimeDefinition: conversation.governanceContext.runtimeDefinition,
      } : undefined,
    };
  }

  private async handleGroupInvitations(
    conversation: any,
    participantEmails: string[],
    userId: string,
    participants?: { email: string; job?: string }[],
  ): Promise<void> {
    if (!conversation.groupMeta) {
      conversation.groupMeta = {
        isGroup: true,
        members: [{
          userId: new Types.ObjectId(userId),
          joinedAt: new Date(),
          status: 'owner',
        }],
        invitedUsers: [],
      };
    }

    const participantMap = new Map(participants?.map(p => [p.email.toLowerCase(), p.job]));
    const existingEmails = new Set([
      ...conversation.groupMeta.invitedUsers.map((u: { email: string }) => u.email.toLowerCase()),
    ]);

    // Populating members to check their emails
    const populatedConversation = await this.conversationModel
      .findById(conversation._id)
      .populate('groupMeta.members.userId', 'email')
      .lean()
      .exec();

    const memberEmails = new Set(
      populatedConversation?.groupMeta?.members
        ?.map((m: any) => m.userId?.email?.toLowerCase())
        .filter(Boolean) || []
    );

    const newEmails = participantEmails
      .map(e => e.trim().toLowerCase())
      .filter(e => e && !existingEmails.has(e) && !memberEmails.has(e));

    if (newEmails.length > 0) {
      const newInvites = newEmails.map(email => ({
        email,
        status: 'Guest' as const,
        invitedAt: new Date(),
        job: participantMap.get(email),
      }));

      conversation.groupMeta.invitedUsers.push(...newInvites);

      // Send invitations
      const owner = await this.userModel.findById(userId).lean().exec();
      const ownerName = owner?.profile ? `${owner.profile.firstName} ${owner.profile.lastName}` : owner?.email;

      this.sendGroupInvitations(
        newEmails,
        conversation._id.toString(),
        conversation.title,
        ownerName || 'Someone',
      ).catch(err => {
        this.logger.error('Failed to send additional group invitations', {
          conversationId: conversation._id,
          error: err.message,
        });
      });
    }
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
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
            <h2 style="color: #333;">You've been invited!</h2>
            <p><strong>${invitedBy}</strong> has invited you to join a new group conversation on YellowStorm.</p>
            <div style="background: #f9f9f9; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p style="margin: 0;"><strong>Conversation:</strong> ${title}</p>
            </div>
            <a href="${conversationUrl}" style="display: inline-block; background: #ea580c; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; font-weight: bold;">Join the Conversation</a>
            <p style="margin-top: 30px; font-size: 12px; color: #777;">If the button doesn't work, copy and paste this link: <br> ${conversationUrl}</p>
          </div>
        `,
        text: `${invitedBy} has invited you to join a new group conversation: ${title} on YellowStorm.\n\nJoin here: ${conversationUrl}`,
      })),
      stopOnError: false,
    });
  }
}
