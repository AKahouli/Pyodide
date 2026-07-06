import {
  Injectable,
  Inject,
  forwardRef,
  OnModuleInit,
  OnModuleDestroy,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { StreamGatewayService } from './stream-gateway.service';
import { MessageService } from './message.service';
import { ConversationService } from './conversation.service';
import { MessageComponent, ComponentType } from '../interfaces/message.interface';
import {
  getComponentType as sharedGetComponentType,
  extractComponentData as sharedExtractComponentData,
  mapTaskStatus as sharedMapTaskStatus,
} from '../utils/component-mapper';
import { GrpcHealthStatus } from '../interfaces/stream.interface';
import { LoggerService, LogOptions } from '../../logger';
import { ServiceUnavailableException, ConflictException } from '../../exceptions';
import { AppException } from '../../exceptions/exceptions/base.exception';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { UsageService } from '../../usage';
import { WorkspaceDocumentService } from '../../workspace/workspace-document.service';
import { WorkspaceService } from '../../workspace/workspace.service';
import { DocumentStatus } from '../../workspace/schemas/workspace-document.schema';
import { AgentService } from '../../agent/agent.service';
import { IGrpcAgent, IGrpcWorkspaceContext } from '../../agent/interfaces/agent.interface';
import { ModelsService } from '../../models/models.service';
import { SkillService } from '../../skill/skill.service';
import {
  buildGrpcChannelCredentials,
  createGrpcMetadata,
} from '../../../common/grpc/grpc-security.util';
import { randomUUID } from 'node:crypto';

interface StreamRequest {
  content: string;
  attachedFileIds?: string[];
  webSearchEnabled?: boolean;
  deepSearchEnabled?: boolean;
  modelId?: string;
  agentIds?: string[];
  connectorRepo?: {
    connectorId: string;
    connectorName: string;
    repoId: string;
    repoName: string;
    repoUrl?: string;
  };
  skillIds?: string[];
}

// Log every Nth chunk to avoid overwhelming logs
const CHUNK_LOG_INTERVAL = 10;

@Injectable()
export class StreamService implements OnModuleInit, OnModuleDestroy {
  private chatbotClient: any;
  private isGrpcAvailable = false;
  private lastError: string | null = null;
  private lastCheckedAt?: Date;
  private activeStreams = new Map<string, Set<string>>(); // userId -> Set<conversationId>
  private componentBuffers = new Map<string, Map<string, MessageComponent>>(); // streamKey -> (componentId -> accumulated component)
  private activeCalls = new Map<string, grpc.ClientReadableStream<any>>(); // streamKey -> gRPC call
  private streamUsage = new Map<
    string,
    { inputTokens: number; outputTokens: number; model: string; modelId?: string }
  >(); // streamKey -> accumulated usage

  constructor(
    private readonly configService: ConfigService,
    private readonly streamGateway: StreamGatewayService,
    private readonly messageService: MessageService,
    private readonly conversationService: ConversationService,
    private readonly logger: LoggerService,
    private readonly usageService: UsageService,
    @Inject(forwardRef(() => WorkspaceDocumentService))
    private readonly workspaceDocumentService: WorkspaceDocumentService,
    private readonly workspaceService: WorkspaceService,
    private readonly agentService: AgentService,
    private readonly modelsService: ModelsService,
    private readonly skillService: SkillService,
  ) {
    this.logger.setContext('StreamService');
  }

  onModuleInit() {
    this.initGrpcClient();
  }

  onModuleDestroy() {
    // Cancel all active gRPC calls
    for (const [, call] of this.activeCalls) {
      call.cancel();
    }
    this.activeCalls.clear();

    // Persist all active buffers
    for (const [streamKey, buffer] of this.componentBuffers) {
      const [, , messageId] = streamKey.split(':');
      if (messageId && buffer.size > 0) {
        this.messageService
          .completeAIMessage({
            messageId,
            components: Array.from(buffer.values()),
          })
          .catch((err) => {
            this.logger.error('Failed to persist buffer on shutdown', {
              messageId,
              error: (err as Error).message,
            });
          });
      }
    }

    this.activeStreams.clear();
    this.componentBuffers.clear();

    if (this.chatbotClient) {
      grpc.closeClient(this.chatbotClient);
    }
  }

  private initGrpcClient() {
    try {
      const protoPath = this.resolveChatbotProtoPath();

      const packageDefinition = protoLoader.loadSync(protoPath, {
        keepCase: true,
        longs: String,
        enums: String,
        defaults: true,
        oneofs: true,
      });

      const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
      const chatbotPackage = protoDescriptor.chatbot as any;

      const grpcUrl = this.configService.get<string>('conversation.grpcUrl', 'localhost:50051');

      const { credentials, options } = buildGrpcChannelCredentials(
        this.configService,
        (msg) => this.logger.warn(msg),
      );

      this.chatbotClient = new chatbotPackage.ChatbotService(grpcUrl, credentials, options);

      // Test connection
      const deadline = new Date(Date.now() + 5000);
      this.chatbotClient.waitForReady(deadline, (err: Error | null) => {
        this.lastCheckedAt = new Date();
        if (err) {
          this.logger.warn('gRPC service unavailable at startup', {
            grpcUrl,
            error: err.message,
          });
          this.isGrpcAvailable = false;
          this.lastError = err.message;
        } else {
          this.logger.log('gRPC client connected', { grpcUrl });
          this.isGrpcAvailable = true;
          this.lastError = null;
        }
      });
    } catch (error) {
      this.logger.error('Failed to initialize gRPC client', {
        error: (error as Error).message,
      });
      this.isGrpcAvailable = false;
      this.lastError = (error as Error).message;
      this.lastCheckedAt = new Date();
    }
  }

  private resolveChatbotProtoPath(): string {
    const candidatePaths = [
      path.join(__dirname, '..', 'proto', 'chatbot.proto'),
      path.resolve(process.cwd(), 'dist', 'modules', 'conversation', 'proto', 'chatbot.proto'),
      path.resolve(process.cwd(), 'src', 'modules', 'conversation', 'proto', 'chatbot.proto'),
    ];

    const existingPath = candidatePaths.find((candidatePath) => fs.existsSync(candidatePath));
    if (!existingPath) {
      throw new Error(`chatbot.proto not found in expected locations: ${candidatePaths.join(', ')}`);
    }

    return existingPath;
  }

  isAvailable(): boolean {
    return this.isGrpcAvailable;
  }

  /** Re-check gRPC connectivity (e.g. ADK started after NestJS boot). */
  waitForGrpcReady(timeoutMs = 5000): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.chatbotClient) {
        resolve(false);
        return;
      }
      const deadline = new Date(Date.now() + timeoutMs);
      this.chatbotClient.waitForReady(deadline, (err: Error | null) => {
        this.lastCheckedAt = new Date();
        if (err) {
          this.isGrpcAvailable = false;
          this.lastError = err.message;
          resolve(false);
          return;
        }
        this.isGrpcAvailable = true;
        this.lastError = null;
        resolve(true);
      });
    });
  }

  getChatbotClient(): any | null {
    if (!this.isGrpcAvailable || !this.chatbotClient) {
      return null;
    }
    return this.chatbotClient;
  }

  /** Resolves workspace documents on agents' brain_context before external gRPC callers (widget, integration). */
  async resolveAgentsBrainContext(agents: IGrpcAgent[]): Promise<void> {
    await this.resolveAgentBrainContexts(agents);
  }

  /**
   * Build workspace contexts for the gRPC request from the conversation's linked workspaces.
   * Returns an array of WorkspaceContext objects matching the proto schema.
   */
  private async buildWorkspaceContexts(
    conversationId: string,
    logOpts?: LogOptions,
    conversationDoc?: { workspaces?: any[] },
  ): Promise<
    Array<{
      workspace_id: string;
      workspace_name: string;
      workspace_documents: Array<{
        _id: string;
        filename: string;
        filepath: string;
        in_memory: boolean;
        language: string;
        indexing_token: number;
        workspace_id: string;
        workspace_name: string;
        file_name: string;
        createdAt: string;
      }>;
    }>
  > {
    try {
      const conversation =
        conversationDoc ?? (await this.conversationService.getConversationDocument(conversationId));
      const workspaceIds = (conversation.workspaces || []).map((w) => w.toString());

      if (workspaceIds.length === 0) {
        return [];
      }

      const contexts: Array<{
        workspace_id: string;
        workspace_name: string;
        workspace_documents: Array<{
          _id: string;
          filename: string;
          filepath: string;
          in_memory: boolean;
          language: string;
          indexing_token: number;
          workspace_id: string;
          workspace_name: string;
          file_name: string;
          createdAt: string;
        }>;
      }> = [];

      for (const workspaceId of workspaceIds) {
        const workspaceName = await this.resolveWorkspaceName(workspaceId);
        const result = await this.workspaceDocumentService.findAllByWorkspace(workspaceId, {
          limit: 1000,
          status: DocumentStatus.COMPLETED,
        });

        contexts.push({
          workspace_id: workspaceId,
          workspace_name: workspaceName,
          workspace_documents: result.documents.map((doc) => ({
            _id: doc.id,
            filename: doc.filename || '',
            filepath: doc.path || '',
            in_memory: false,
            language: doc.detected_language || 'fr',
            indexing_token: doc.chunk_size || 1200,
            workspace_id: workspaceId,
            workspace_name: workspaceName,
            file_name: doc.filename || '',
            createdAt: doc.createdAt,
          })),
        });
      }

      this.logger.debug('Workspace contexts built', {
        conversationId,
        workspaceCount: contexts.length,
        totalDocuments: contexts.reduce((sum, ctx) => sum + ctx.workspace_documents.length, 0),
      });

      return contexts;
    } catch (error) {
      this.logger.warn('Failed to build workspace contexts, continuing with empty context', {
        conversationId,
        error: (error as Error).message,
      });
      return [];
    }
  }

  /**
   * Resolve full workspace documents for each agent's brain_context (knowledge bases).
   * Deduplicates shared workspaces and fetches all in parallel.
   */
  private async resolveAgentBrainContexts(agents: IGrpcAgent[]): Promise<void> {
    const allWsIds = [...new Set(agents.flatMap((a) => a.brain_context.map((c) => c.workspace_id)))];
    if (allWsIds.length === 0) return;

    const contextMap = new Map<string, IGrpcWorkspaceContext>();
    const results = await Promise.allSettled(
      allWsIds.map(async (wsId) => {
        const result = await this.workspaceDocumentService.findAllByWorkspace(wsId, {
          limit: 1000,
          status: DocumentStatus.COMPLETED,
        });
        const workspaceName = await this.resolveWorkspaceName(wsId);
        contextMap.set(wsId, {
          workspace_id: wsId,
          workspace_name: workspaceName,
          workspace_documents: result.documents.map((doc) => ({
            _id: doc.id,
            filename: doc.filename || '',
            filepath: doc.path || '',
            in_memory: false,
            language: doc.detected_language || 'fr',
            indexing_token: doc.chunk_size || 1200,
            workspace_id: wsId,
            workspace_name: workspaceName,
            file_name: doc.filename || '',
            createdAt: doc.createdAt,
          })),
        });
      }),
    );

    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'rejected') {
        this.logger.warn('Failed to resolve brain context workspace', {
          workspaceId: allWsIds[i],
          error: (results[i] as PromiseRejectedResult).reason?.message,
        });
      }
    }

    for (const agent of agents) {
      agent.brain_context = agent.brain_context
        .map((c) => contextMap.get(c.workspace_id))
        .filter(Boolean) as IGrpcWorkspaceContext[];
    }
  }

  /**
   * Build AttachedFile[] for the current turn's files in the proto format.
   * Distinguishes images from documents based on MIME type.
   */
  private async buildAttachedFiles(
    attachedFileIds: string[],
  ): Promise<
    Array<{
      type: string;
      image?: { filepath: string };
      document?: {
        filepath: string;
        filename: string;
        workspace_name: string;
        workspace_id: string;
        source: string;
        createdAt: string;
        brain_type: string;
        lang_code: string;
        chunk_size: number;
        chunk_overlap: number;
        enable_smart_chunk: boolean;
        enable_extract_images: boolean;
        sheet_name: string;
        in_memory: boolean;
      };
    }>
  > {
    if (!attachedFileIds.length) return [];

    try {
      const documents = await this.workspaceDocumentService.findByIds(attachedFileIds);

      if (documents.length !== attachedFileIds.length) {
        this.logger.warn('Some attached files not found in database', {
          requested: attachedFileIds.length,
          found: documents.length,
          missingIds: attachedFileIds.filter(
            (id) => !documents.some((d) => d.id === id),
          ),
        });
      }

      return documents.map((doc) => {
        const isImage = doc.mimeType.startsWith('image/');

        if (isImage) {
          return {
            type: 'image',
            image: { filepath: doc.path || '', createdAt: doc.createdAt },
          };
        }
        return {
          type: 'document',
          document: {
            filepath: doc.path || '',
            filename: doc.filename || '',
            workspace_name: this.workspaceNameFromPath(doc.path, doc.workspaceId),
            workspace_id: doc.workspaceId,
            source: doc.path || '',
            brain_type: 'doc',
            lang_code: 'fr',
            chunk_size: 4000,
            chunk_overlap: 100,
            enable_smart_chunk: false,
            enable_extract_images: false,
            sheet_name: '',
            in_memory: false,
            createdAt: doc.createdAt,
          },
        };
      });
    } catch (error) {
      this.logger.error('Failed to build attached files', {
        attachedFileIds,
        error: (error as Error).message,
      });
      return [];
    }
  }

  /**
   * Build previous_attached_files from the conversation's system workspace.
   * Returns all completed documents except those in the current turn.
   */
  private async buildPreviousAttachedFiles(
    systemWorkspaceId: string | undefined,
    currentFileIds: string[],
  ): Promise<
    Array<{
      _id: string;
      filename: string;
      filepath: string;
      in_memory: boolean;
      language: string;
      indexing_token: number;
        workspace_id: string;
        workspace_name: string;
        file_name: string;
        createdAt: string;
      }>
  > {
    if (!systemWorkspaceId) return [];

    try {
      const result = await this.workspaceDocumentService.findAllByWorkspace(
        systemWorkspaceId,
        { limit: 1000, status: DocumentStatus.COMPLETED },
      );

      const currentIdSet = new Set(currentFileIds);
      const previousDocs = result.documents.filter((doc) => !currentIdSet.has(doc.id));

      this.logger.debug('Previous attached files resolved', {
        systemWorkspaceId,
        totalInWorkspace: result.documents.length,
        currentTurnFiles: currentFileIds.length,
        previousFiles: previousDocs.length,
      });

      return previousDocs.map((doc) => ({
        _id: doc.id,
        filename: doc.filename || '',
        filepath: doc.path || '',
        in_memory: false,
        language: doc.detected_language || 'fr',
        indexing_token: doc.chunk_size || 1200,
        workspace_id: systemWorkspaceId,
        workspace_name: this.workspaceNameFromPath(doc.path, systemWorkspaceId),
        file_name: doc.filename || '',
        createdAt: doc.createdAt,
      }));
    } catch (error) {
      this.logger.warn('Failed to build previous attached files, continuing without them', {
        systemWorkspaceId,
        error: (error as Error).message,
      });
      return [];
    }
  }

  async startStream(
    userId: string,
    conversationId: string,
    messageId: string,
    request: StreamRequest,
    requestId?: string,
    userEmail: string = '',
    username?: string,
  ): Promise<void> {
    const logOpts: LogOptions = { requestId };

    this.logger.debug(
      'Stream start requested',
      {
        userId,
        username,
        conversationId,
        messageId,
        contentLength: request.content.length,
        hasFiles: !!request.attachedFileIds?.length,
        fileCount: request.attachedFileIds?.length || 0,
        webSearchEnabled: request.webSearchEnabled,
        modelId: request.modelId,
      },
      logOpts,
    );
    if (!this.isGrpcAvailable) {
      this.logger.error('gRPC unavailable', { conversationId, messageId }, logOpts);
      this.sendErrorEvent(userId, conversationId, ErrorCode.CHAT_GRPC_UNAVAILABLE);
      throw new ServiceUnavailableException(
        ErrorCode.CHAT_GRPC_UNAVAILABLE,
        'AI service is currently unavailable',
      );
    }
    // Check concurrency
    const maxStreams = this.configService.get<number>('conversation.maxConcurrentStreams', 5);
    const userStreams = this.activeStreams.get(userId);
    this.logger.debug(
      'Checking stream concurrency',
      {
        userId,
        currentStreams: userStreams?.size || 0,
        maxStreams,
      },
      logOpts,
    );

    if (userStreams && userStreams.size >= maxStreams) {
      this.logger.warn(
        'Stream limit reached',
        {
          userId,
          currentStreams: userStreams.size,
          maxStreams,
        },
        logOpts,
      );
      this.sendErrorEvent(userId, conversationId, ErrorCode.CHAT_STREAM_LIMIT);
      throw new AppException({
        code: ErrorCode.CHAT_STREAM_LIMIT,
        message: 'Maximum concurrent streams reached',
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
      });
    }

    // Check if conversation already streaming
    if (userStreams?.has(conversationId)) {
      this.logger.warn('Conversation already streaming', { conversationId }, logOpts);
      this.sendErrorEvent(userId, conversationId, ErrorCode.CHAT_ALREADY_STREAMING);
      throw new ConflictException(
        ErrorCode.CHAT_ALREADY_STREAMING,
        'This conversation is already streaming',
      );
    }

    // Register active stream
    if (!this.activeStreams.has(userId)) {
      this.activeStreams.set(userId, new Set());
    }
    this.activeStreams.get(userId)!.add(conversationId);

    const streamKey = `${userId}:${conversationId}:${messageId}`;
    this.componentBuffers.set(streamKey, new Map());
    this.streamUsage.set(streamKey, {
      inputTokens: 0,
      outputTokens: 0,
      model: '',
      modelId: request.modelId,
    });

    this.logger.debug(
      'Stream registered, starting gRPC call',
      {
        streamKey,
        conversationId,
        messageId,
      },
      logOpts,
    );

    // Resolve conversation members for broadcasting
    const memberIds = await this.resolveMemberIds(conversationId);

    // Send stream_start event to all members
    await this.streamGateway.broadcastToConversation(
      memberIds, {
      type: 'stream_start',
      data: { conversationId, messageId },
    });

    // Fetch conversation document once for workspace contexts and system workspace
    const conversation = await this.conversationService.getConversationDocument(conversationId);
    const systemWorkspaceId = conversation.systemWorkspaceId?.toString();

    // Fetch group members if it's a group conversation
    const groupMembers = conversation.groupMeta?.isGroup
      ? await this.conversationService.getGroupMembers(conversationId)
      : [];

    // Build workspace contexts, agents, and attached files in parallel where possible
    const sharedAgentIds = conversation.groupMeta?.isGroup
      ? conversation.groupMeta.taggedAgents?.map((id) => id.toString()) || []
      : [];

    const [workspaceContexts, agents] = await Promise.all([
      this.buildWorkspaceContexts(conversationId, logOpts, conversation),
      this.agentService.buildAgentsForStream(
        userId,
        request.modelId,
        request.agentIds,
        sharedAgentIds,
        groupMembers,
        request.connectorRepo?.connectorId,
      ),
    ]);

    // Resolve agent brain contexts, current-turn attached files, and previous files in parallel
    const currentFileIds = request.attachedFileIds || [];
    const [, attachedFiles, previousAttachedFiles, grpcSkills] = await Promise.all([
      this.resolveAgentBrainContexts(agents),
      this.buildAttachedFiles(currentFileIds),
      this.buildPreviousAttachedFiles(systemWorkspaceId, currentFileIds),
      request.skillIds?.length
        ? this.skillService.findByIdsForGrpc(request.skillIds)
        : Promise.resolve([]),
    ]);

    // Decide which RPC to use based on the resolved roster (see
    // AgentService.buildAgentsForStream): the roster contains exactly one agent
    // when the user tagged no agent (the default mono-agent) or tagged a single
    // agent of any type — both run through RunSingleAgent. When the user tagged
    // multiple agents the roster carries those agents plus the manager and runs
    // through RunAgentTeam.
    const useSingleAgent = agents.length === 1;

    const baseRequest = {
      user_context: { user_id: userId, username: username || '' },
      conversation_id: conversationId,
      query: request.content,
      workspace_context: workspaceContexts?.length
        ? workspaceContexts
        : [{ workspace_id: conversationId, workspace_name: conversationId, workspace_documents: [] }],
      attached_files: attachedFiles,
      previous_attached_files: previousAttachedFiles,
      deep_search_enabled: request.deepSearchEnabled ?? false,
      ...(request.connectorRepo
        ? {
            connector_repo: {
              connector_id: request.connectorRepo.connectorId,
              connector_name: request.connectorRepo.connectorName,
              repo_id: request.connectorRepo.repoId,
              repo_name: request.connectorRepo.repoName,
              repo_url: request.connectorRepo.repoUrl ?? '',
            },
          }
        : {}),
      ...(grpcSkills.length ? { skills: grpcSkills } : {}),
    };

    // RunSingleAgentRequest carries a single `agent` and no `agent_mode`;
    // RunAgentTeamRequest carries the `agents` roster and an `agent_mode`.
    const grpcRequest = useSingleAgent
      ? { ...baseRequest, agent: agents[0] }
      : { ...baseRequest, agents, agent_mode: 'manual' };

    const timeoutMs = this.configService.get<number>('conversation.grpcTimeoutMs', 120000);
    this.logger.debug(
      `GRPC request Prepared with an idle timeout of ${timeoutMs}ms (rpc=${useSingleAgent ? 'RunSingleAgent' : 'RunAgentTeam'})`,
      grpcRequest,
      logOpts,
    );
    try {
      await this.executeGrpcStream(
        userId,
        conversationId,
        messageId,
        streamKey,
        grpcRequest,
        timeoutMs,
        memberIds,
        requestId,
        username,
        useSingleAgent,
      );
    } catch (error) {
      this.logger.error(
        'Stream execution failed',
        {
          streamKey,
          conversationId,
          messageId,
          error: (error as Error).message,
        },
        logOpts,
      );
      this.cleanupStream(userId, conversationId, streamKey);
      throw error;
    }
  }

  async stopStream(userId: string, conversationId: string, messageId: string): Promise<void> {
    const streamKey = `${userId}:${conversationId}:${messageId}`;

    this.logger.debug('Stream stop requested', {
      userId,
      conversationId,
      messageId,
      streamKey,
    });

    const call = this.activeCalls.get(streamKey);

    if (!call) {
      this.logger.warn('No active stream found for stop request', { streamKey });
      throw new AppException({
        code: ErrorCode.CHAT_STREAM_FAILED,
        message: 'No active stream found',
        statusCode: HttpStatus.NOT_FOUND,
      });
    }

    // Remove from activeCalls first to prevent error handler from double-processing
    this.activeCalls.delete(streamKey);

    // Persist current buffer
    const buffer = this.componentBuffers.get(streamKey) || new Map();
    if (buffer.size > 0) {
        this.logger.debug('Persisting buffer on stop', {
        streamKey,
        bufferSize: buffer.size,
      });
      try {
        await this.messageService.completeAIMessage({
          messageId,
          components: Array.from(buffer.values()),
        });
      } catch (err) {
        this.logger.error('Failed to persist buffer on stop', {
          messageId,
          error: (err as Error).message,
        });
      }
    } else {
      await this.messageService.markStreamFailed(messageId);
    }

    // Record partial usage on stop
    const usageData = this.streamUsage.get(streamKey);
    if (usageData && (usageData.inputTokens > 0 || usageData.outputTokens > 0)) {
        this.logger.debug('Recording partial usage on stop', {
        streamKey,
        inputTokens: usageData.inputTokens,
        outputTokens: usageData.outputTokens,
      });
      try {
        await this.usageService.recordUsage({
          userId,
          inputTokens: usageData.inputTokens,
          outputTokens: usageData.outputTokens,
          modelName: usageData.model || usageData.modelId || undefined,
          conversationId,
          success: true,
        });
      } catch (err) {
        this.logger.error('Failed to record usage on stop', {
          error: (err as Error).message,
          streamKey,
        });
      }
    }

    // Send stream_complete so frontend treats it as normal completion
    this.streamGateway.sendToUser(userId, {
      type: 'stream_complete',
      data: {
        conversationId,
        messageId,
        usage: {
          inputTokens: usageData?.inputTokens || 0,
          outputTokens: usageData?.outputTokens || 0,
          durationMs: 0,
        },
      },
    });

    // Cancel the gRPC call and cleanup
    call.cancel();
    this.cleanupStream(userId, conversationId, streamKey);

    this.logger.debug('Stream stopped successfully', {
      streamKey,
      conversationId,
      messageId,
    });
  }

  private executeGrpcStream(
    userId: string,
    conversationId: string,
    messageId: string,
    streamKey: string,
    grpcRequest: any,
    timeoutMs: number,
    memberIds: string[],
    requestId?: string,
    username?: string,
    useSingleAgent = false,
  ): Promise<void> {
    const logOpts: LogOptions = { requestId };

    return new Promise<void>((resolve, reject) => {
      this.logger.debug(
        'gRPC call initiated',
        {
          streamKey,
          conversationId,
          messageId,
          timeoutMs,
          username,
        },
        logOpts,
      );

      // Create metadata with user header for LiteLLM logging + shared API key
      const metadata = createGrpcMetadata(this.configService);
      const userHeader = username || 'SYSTEM'; // Use 'SYSTEM' for non-user requests
      metadata.set('user', userHeader);

      // No absolute deadline - we use idle timeout instead.
      // Pass metadata as the positional metadata arg — wrapping it as
      // `{ metadata }` makes grpc-js treat it as call options and silently
      // drop the headers (x-api-key + user).
      //
      // Route to the matching RPC: a single-agent roster is sent as a
      // RunSingleAgentRequest (carries `agent`, no manager), everything else as
      // a RunAgentTeamRequest (carries the `agents` roster + manager). Without
      // this branch a single-agent request hits RunAgentTeam with an empty
      // `agents` list and the ADK rejects it with "No Manager agent was found".
      const call = useSingleAgent
        ? this.chatbotClient.RunSingleAgent(grpcRequest, metadata)
        : this.chatbotClient.RunAgentTeam(grpcRequest, metadata);
      this.activeCalls.set(streamKey, call);

      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let chunkCount = 0;
      let lastLoggedChunk = 0;
      const startTime = Date.now();
      let timeToFirstChunk: number | null = null;
      let timeToFirstToken: number | null = null;

      // Idle timeout - resets every time data is received
      let timeoutHandle: NodeJS.Timeout | null = null;
      const resetIdleTimeout = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        timeoutHandle = setTimeout(() => {
          this.logger.error(
            'Stream idle timeout',
            {
              streamKey,
              chunksReceived: chunkCount,
              timeoutMs,
            },
            logOpts,
          );
          call.cancel();
          this.handleStreamError(
            userId,
            conversationId,
            messageId,
            streamKey,
            ErrorCode.CHAT_STREAM_TIMEOUT,
            requestId,
          );
          reject(new Error('Stream idle timeout - no data received'));
        }, timeoutMs);
      };

      // Start the initial idle timeout
      resetIdleTimeout();

      call.on('data', (chunk: any) => {
        // Reset idle timeout on each chunk received
        resetIdleTimeout();
        chunkCount++;
        console.log(chunk);
        // Capture time to first chunk

        // Capture time to first
        if (chunkCount === 1) {
          timeToFirstChunk = Date.now() - startTime;
        }

        try {
          const action = chunk.action;
          const comp = chunk.component;

          // Sample logging to avoid overwhelming logs
          if (chunkCount - lastLoggedChunk >= CHUNK_LOG_INTERVAL) {
            this.logger.debug(
              'Stream chunks received',
              {
                streamKey,
                chunkCount,
                hasComponent: !!comp,
                hasUsage: !!chunk.usage,
                inputTokens: totalInputTokens,
                outputTokens: totalOutputTokens,
              },
              logOpts,
            );
            lastLoggedChunk = chunkCount;
          }

          if (comp && comp.id && (action === 'add' || action === 'update' || action === 'delete')) {
            if (action === 'delete') {
              const buffer = this.componentBuffers.get(streamKey);
              if (buffer) {
                buffer.delete(comp.id);
              }

              // Send chunk immediately to frontend (only id needed for delete)
              this.streamGateway.broadcastToConversation(
                memberIds, {
                type: 'stream_chunk',
                data: { conversationId, action, component: { id: comp.id } as MessageComponent },
              }).catch((err) => {
                this.logger.error('Failed to broadcast delete chunk', { error: err.message, streamKey }, logOpts);
              });
            } else {
              const buffer = this.componentBuffers.get(streamKey);
              if (buffer) {
                this.applyChunkToBuffer(buffer, action, comp);
              }

              // Extract component type and data from oneof structure
              const { type, data } = this.extractComponentData(comp);

              // Debug logging for chart components
              if (type === 'chart') {
                this.logger.debug('[Chart chunk] Sending to frontend', {
                  id: comp.id,
                  action,
                  dataKeys: Object.keys(data),
                  hasData: 'data' in data,
                  hasChartData: 'chartData' in data,
                  dataDataType: typeof data.data,
                  chartDataDataType: typeof data.chartData,
                  dataValue: data.data,
                  chartDataValue: data.chartData,
                }, logOpts);
              }

              // Capture time to first token when first text/reasoning content appears
              if (timeToFirstToken === null) {
                if ((type === 'text' || type === 'reasoning') && data?.content) {
                  timeToFirstToken = Date.now() - startTime;
                }
              }

              // Send chunk immediately to frontend
              this.streamGateway.broadcastToConversation(
                memberIds, {
                type: 'stream_chunk',
                data: { conversationId, action, component: { id: comp.id, type, data } },
              }).catch((err) => {
                this.logger.error('Failed to broadcast stream chunk', { error: err.message, streamKey }, logOpts);
              });
            }
          }

          // Track usage
          if (chunk.usage) {
            totalInputTokens += chunk.usage.input_tokens || 0;
            totalOutputTokens += chunk.usage.output_tokens || 0;
            const usageData = this.streamUsage.get(streamKey);
            if (usageData) {
              usageData.inputTokens = totalInputTokens;
              usageData.outputTokens = totalOutputTokens;
              if (chunk.usage.model) {
                usageData.model = chunk.usage.model;
              }
            }
          }
        } catch (error) {
          this.logger.error(
            'Error processing stream chunk',
            {
              error: (error as Error).message,
              streamKey,
              chunkCount,
            },
            logOpts,
          );
        }
      });

      call.on('end', async () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);

        // If stopStream() already handled this call, don't double-process
        if (!this.activeCalls.has(streamKey)) {
          this.logger.debug('Stream already handled by stopStream', { streamKey }, logOpts);
          resolve();
          return;
        }

        const durationMs = Date.now() - startTime;

        this.logger.debug(
          'gRPC stream ended',
          {
            streamKey,
            totalChunks: chunkCount,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            durationMs,
          },
          logOpts,
        );

        try {
          const buffer = this.componentBuffers.get(streamKey) || new Map();
          const components = Array.from(buffer.values());

          // Move plan component to the top so it appears first in the persisted message
          const planIndex = components.findIndex((c) => c.type === 'plan');
          if (planIndex > 0) {
            const [plan] = components.splice(planIndex, 1);
            components.unshift(plan);
          }

          this.logger.debug(
            'Persisting stream components',
            {
              streamKey,
              componentCount: components.length,
            },
            logOpts,
          );

          // Persist the complete message
          await this.messageService.completeAIMessage({
            messageId,
            components,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            durationMs,
            timeToFirstChunk: timeToFirstChunk ?? undefined,
            timeToFirstToken: timeToFirstToken ?? undefined,
          });

          // Record usage
          const usageData = this.streamUsage.get(streamKey);
          this.logger.debug(
            'Recording usage',
            {
              streamKey,
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
              model: usageData?.model,
            },
            logOpts,
          );
          try {
            await this.usageService.recordUsage({
              userId,
              inputTokens: totalInputTokens,
              outputTokens: totalOutputTokens,
              modelName: usageData?.model || usageData?.modelId || undefined,
              conversationId,
              durationMs,
              success: true,
            });
          } catch (err) {
            this.logger.error(
              'Failed to record usage',
              {
                error: (err as Error).message,
                streamKey,
              },
              logOpts,
            );
          }

          // Send complete event
          await this.streamGateway.broadcastToConversation(
            memberIds, {
            type: 'stream_complete',
            data: {
              conversationId,
              messageId,
              usage: {
                inputTokens: totalInputTokens,
                outputTokens: totalOutputTokens,
                durationMs,
              },
            },
          });

          this.cleanupStream(userId, conversationId, streamKey);

          this.logger.debug(
            'Stream completed successfully',
            {
              streamKey,
              conversationId,
              messageId,
              totalChunks: chunkCount,
              durationMs,
            },
            logOpts,
          );

          resolve();
        } catch (error) {
          this.logger.error(
            'Error completing stream',
            {
              error: (error as Error).message,
              streamKey,
            },
            logOpts,
          );
          this.cleanupStream(userId, conversationId, streamKey);
          reject(error);
        }
      });

      call.on('error', (error: any) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);

        // If stopStream() already handled this call, don't double-process
        if (!this.activeCalls.has(streamKey)) {
          this.logger.debug('Stream error after stopStream handling', { streamKey }, logOpts);
          resolve();
          return;
        }

        this.logger.error(
          'gRPC stream error',
          {
            error: error.message,
            errorCode: error.code,
            streamKey,
            chunksBeforeError: chunkCount,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
          },
          logOpts,
        );

        // UNAUTHENTICATED (16) means a wrong/missing/rotated API key, not a
        // transient outage. Surface it distinctly instead of the generic
        // stream-failed so it doesn't get mistaken for "AI service down".
        const errorCode =
          error?.code === grpc.status.UNAUTHENTICATED
            ? ErrorCode.CHAT_GRPC_UNAUTHENTICATED
            : ErrorCode.CHAT_STREAM_FAILED;

        this.handleStreamError(
          userId,
          conversationId,
          messageId,
          streamKey,
          errorCode,
          requestId,
        );
        reject(error);
      });
    });
  }

  private async handleStreamError(
    userId: string,
    conversationId: string,
    messageId: string,
    streamKey: string,
    errorCode: ErrorCode,
    requestId?: string,
  ): Promise<void> {
    const logOpts: LogOptions = { requestId };

    this.logger.error(
      'Handling stream error',
      {
        userId,
        conversationId,
        messageId,
        streamKey,
        errorCode,
      },
      logOpts,
    );

    // Persist partial buffer with an error component appended
    const buffer = this.componentBuffers.get(streamKey) || new Map();

    // Add an error component so the message itself shows the error visually
    const errorComponentId = `error-${randomUUID()}`;
    buffer.set(errorComponentId, {
      id: errorComponentId,
      type: 'error' as ComponentType,
      data: {
        code: errorCode,
        message: this.getErrorMessage(errorCode),
      },
    });

    this.logger.debug(
      'Persisting buffer with error component',
      {
        streamKey,
        bufferSize: buffer.size,
      },
      logOpts,
    );
    try {
      await this.messageService.completeAIMessage({
        messageId,
        components: Array.from(buffer.values()),
      });
    } catch (err) {
      this.logger.error(
        'Failed to persist buffer with error component',
        {
          messageId,
          error: (err as Error).message,
        },
        logOpts,
      );
    }

    // Record partial usage
    const usageData = this.streamUsage.get(streamKey);
    if (usageData && (usageData.inputTokens > 0 || usageData.outputTokens > 0)) {
      this.logger.debug(
        'Recording partial usage on error',
        {
          streamKey,
          inputTokens: usageData.inputTokens,
          outputTokens: usageData.outputTokens,
        },
        logOpts,
      );
      try {
        await this.usageService.recordUsage({
          userId,
          inputTokens: usageData.inputTokens,
          outputTokens: usageData.outputTokens,
          modelName: usageData.model || usageData.modelId || undefined,
          conversationId,
          success: false,
          errorCode: errorCode,
        });
      } catch (err) {
        this.logger.error(
          'Failed to record usage on error',
          {
            error: (err as Error).message,
            streamKey,
          },
          logOpts,
        );
      }
    }

    // Send error event to user
    this.sendErrorEvent(userId, conversationId, errorCode);
    this.cleanupStream(userId, conversationId, streamKey);

    this.logger.debug(
      'Stream error handling completed',
      {
        streamKey,
        errorCode,
      },
      logOpts,
    );
  }

  private async sendErrorEvent(userId: string, conversationId: string, errorCode: ErrorCode): Promise<void> {
    const memberIds = await this.resolveMemberIds(conversationId);
    await this.streamGateway.broadcastToConversation(
      memberIds, {
      type: 'stream_error',
      data: {
        conversationId,
        errorCode,
        message: this.getErrorMessage(errorCode),
      },
    });
  }

  private cleanupStream(userId: string, conversationId: string, streamKey: string): void {
    this.activeCalls.delete(streamKey);
    this.componentBuffers.delete(streamKey);
    this.streamUsage.delete(streamKey);
    const userStreams = this.activeStreams.get(userId);
    if (userStreams) {
      userStreams.delete(conversationId);
      if (userStreams.size === 0) {
        this.activeStreams.delete(userId);
      }
    }
  }

  private getComponentType(comp: any): ComponentType {
    return sharedGetComponentType(comp);
  }

  private extractComponentData(comp: any): { type: ComponentType; data: Record<string, unknown> } {
    return sharedExtractComponentData(comp);
  }

  /**
   * Applies a chunk to the component buffer.
   * - 'add': Creates a new component entry
   * - 'update': Merges data into existing component
   *
   * Type-specific behavior:
   * - text/code/reasoning: Append to content string
   * - queue/plan/checkpoint/task: Replace entire data (arrives in one chunk)
   */
  private applyChunkToBuffer(
    buffer: Map<string, MessageComponent>,
    action: string,
    comp: any,
  ): void {
    const componentId = comp.id;
    const { type, data } = this.extractComponentData(comp);

    if (action === 'add') {
      buffer.set(componentId, {
        id: componentId,
        type,
        data: { ...data },
      });
    } else if (action === 'update') {
      const existing = buffer.get(componentId);
      if (existing) {
        existing.data = this.mergeComponentData(type, existing.data, data);
      }
    }
  }

  /**
   * Merge incoming data into existing component data based on type.
   */
  private mergeComponentData(
    type: ComponentType,
    existing: Record<string, unknown>,
    incoming: Record<string, unknown>,
  ): Record<string, unknown> {
    switch (type) {
      case 'text':
      case 'reasoning': {
        // Append content for streaming text types
        const existingContent = (existing.content as string) || '';
        const newContent = (incoming.content as string) || '';
        return {
          ...existing,
          content: existingContent + newContent,
        };
      }
      case 'code': {
        // Append content, preserve language/filename from first chunk
        const existingContent = (existing.content as string) || '';
        const newContent = (incoming.content as string) || '';
        return {
          ...existing,
          content: existingContent + newContent,
          // Only update language/filename if incoming has non-empty values
          language: (incoming.language as string) || existing.language,
          filename: (incoming.filename as string) || existing.filename,
        };
      }
      case 'queue':
      case 'plan':
      case 'checkpoint':
      case 'task':
      case 'chart':
      case 'sources':
      case 'webPreview':
      case 'artifact':
      case 'citation':
        // These arrive fully formed - replace with incoming data
        return { ...incoming };
      case 'sandbox':
        // Sandbox: merge code from first chunk with output/error from update
        return {
          code: (incoming.code as string) || (existing.code as string) || '',
          output: (incoming.output as string) || (existing.output as string) || '',
          error: (incoming.error as string) || (existing.error as string) || '',
          outputAvailable: incoming.outputAvailable ?? existing.outputAvailable ?? false,
        };
      default:
        return { ...existing, ...incoming };
    }
  }

  private mapTaskStatus(status: string | undefined): string {
    return sharedMapTaskStatus(status);
  }

  private getErrorMessage(code: ErrorCode): string {
    const messages: Record<string, string> = {
      [ErrorCode.CHAT_GRPC_UNAVAILABLE]: 'AI service is currently unavailable.',
      [ErrorCode.CHAT_GRPC_UNAUTHENTICATED]:
        'AI service rejected the request (authentication failed).',
      [ErrorCode.CHAT_STREAM_LIMIT]: 'Maximum concurrent streams reached.',
      [ErrorCode.CHAT_STREAM_FAILED]: 'AI stream failed unexpectedly.',
      [ErrorCode.CHAT_STREAM_TIMEOUT]: 'AI stream timed out.',
      [ErrorCode.CHAT_ALREADY_STREAMING]: 'This conversation is already streaming.',
    };
    return messages[code] || 'An unexpected error occurred.';
  }

  getHealthStatus(): GrpcHealthStatus {
    const grpcUrl = this.configService.get<string>('conversation.grpcUrl', 'localhost:50051');

    let totalActiveStreams = 0;
    for (const streams of this.activeStreams.values()) {
      totalActiveStreams += streams.size;
    }

    return {
      available: !!this.chatbotClient,
      connected: this.isGrpcAvailable,
      error: this.lastError,
      lastCheckedAt: this.lastCheckedAt,
      activeStreams: totalActiveStreams,
      grpcUrl,
    };
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async checkGrpcHealth() {
    if (!this.chatbotClient) {
      this.isGrpcAvailable = false;
      this.lastError = 'gRPC client not initialized';
      this.lastCheckedAt = new Date();
      return;
    }

    const deadline = new Date(Date.now() + 5000);
    this.chatbotClient.waitForReady(deadline, (err: Error | null) => {
      this.lastCheckedAt = new Date();
      if (err) {
        if (this.isGrpcAvailable) {
          this.logger.warn('gRPC connection lost', { error: err.message });
        }
        this.isGrpcAvailable = false;
        this.lastError = err.message;
      } else {
        if (!this.isGrpcAvailable) {
          this.logger.log('gRPC connection restored');
        }
        this.isGrpcAvailable = true;
        this.lastError = null;
      }
    });
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async cleanupStaleStreams() {
    const staleMinutes = this.configService.get<number>(
      'conversation.staleStreamCleanupMinutes',
      30,
    );

    const count = await this.messageService.cleanupStaleStreams(staleMinutes);
    if (count > 0) {
      this.logger.debug('Cleaned up stale streams', { count });
    }
  }

  /**
   * Generates a conversation name asynchronously (fire-and-forget).
   * Sends the result via SSE to the user.
   */
  generateConversationNameAsync(
    userId: string,
    conversationId: string,
    query: string,
    modelId?: string,
    username?: string,
  ): void {
    // Fire and forget - don't await at call site
    this.generateConversationName(userId, conversationId, query, modelId, username).catch((err) => {
      this.logger.error('Failed to generate conversation name', {
        conversationId,
        error: (err as Error).message,
      });
    });
  }

  private async generateConversationName(
    userId: string,
    conversationId: string,
    query: string,
    modelId?: string,
    username?: string,
  ): Promise<void> {
    try {
      // Resolve modelId to litellmModel from the database
      let litellmModel = '';
      if (modelId) {
        const model = await this.modelsService.getDefaultModel();
        litellmModel = model?.litellmModel || '';
      }

      const response = await this.callGenerateNameGrpc(query, litellmModel, username);
      const generatedName = response.conversation_name || 'New Conversation';

      // Update conversation title in database
      await this.conversationService.updateConversationInternal(conversationId, {
        title: generatedName,
      });

      // Send SSE event to user
      this.streamGateway.sendToUser(userId, {
        type: 'conversation_name_generated',
        data: {
          conversationId,
          name: generatedName,
        },
      });

      this.logger.debug('Conversation name generated', {
        conversationId,
        name: generatedName,
      });
    } catch (error) {
      // Fallback: keep existing title, log warning
      this.logger.warn('Name generation failed, keeping default title', {
        conversationId,
        error: (error as Error).message,
      });
    }
  }

  private callGenerateNameGrpc(
    query: string,
    modelId?: string,
    username?: string,
  ): Promise<{ conversation_name: string }> {
    return new Promise((resolve, reject) => {
      if (!this.chatbotClient) {
        reject(new Error('gRPC client not initialized'));
        return;
      }

      // Create metadata with user header for LiteLLM logging + shared API key
      const metadata = createGrpcMetadata(this.configService);
      const userHeader = username || 'SYSTEM'; // Use 'SYSTEM' for non-user requests
      metadata.set('user', userHeader);

      const deadline = new Date(Date.now() + 60000); // 60s timeout
      this.chatbotClient.GenerateConversationName(
        { query, model: modelId || '' },
        metadata,
        { deadline },
        (err: Error | null, response: { conversation_name: string }) => {
          if (err) reject(err);
          else resolve(response);
        },
      );
    });
  }

  private async resolveMemberIds(conversationId: string): Promise<string[]> {
    try {
      const conversation = await this.conversationService.findById(conversationId);
      const userIds: string[] = [conversation.createdBy];

      if (conversation.groupMeta?.isGroup) {
        conversation.groupMeta.members.forEach((member) => {
          if (!userIds.includes(member.userId)) {
            userIds.push(member.userId);
          }
        });
      }

      return userIds;
    } catch (err) {
      this.logger.warn('Failed to resolve member ids for broadcast', {
        conversationId,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
      return [];
    }
  }

  private async resolveWorkspaceName(workspaceId: string): Promise<string> {
    try {
      const context = await this.workspaceService.getStorageContext(workspaceId);
      return context.storagePrefix || workspaceId;
    } catch (error) {
      this.logger.warn('Failed to resolve workspace name for search metadata', {
        workspaceId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return workspaceId;
    }
  }

  private workspaceNameFromPath(filePath: string | undefined, fallback: string): string {
    const parts = String(filePath || '').split('/').filter(Boolean);
    return parts.length >= 2 ? parts[1] : fallback;
  }

  /**
   * Runs a single linked agent via gRPC RunSingleAgent (agent_mode=mono on ADK side).
   * Used by WhatsApp inbound replies — no manager orchestration, no SSE gateway.
   */
  async runSingleAgentStream(params: {
    userId: string;
    username: string;
    conversationId: string;
    messageId: string;
    agentId: string;
    query: string;
    requestId?: string;
  }): Promise<{ durationMs: number; componentCount: number; chunkCount: number }> {
    if (!this.isGrpcAvailable) {
      throw new ServiceUnavailableException(
        ErrorCode.CHAT_GRPC_UNAVAILABLE,
        'gRPC service is not available for single-agent streaming',
      );
    }

    const logOpts: LogOptions = { requestId: params.requestId };
    const defaultModel = await this.modelsService.getDefaultModel();
    const fallbackModelId = this.modelsService.getModelIdentifier(defaultModel) || '';

    const grpcAgents = await this.agentService.buildGrpcAgentsForPlaybook(
      params.userId,
      [params.agentId],
      fallbackModelId,
      params.conversationId,
    );
    if (grpcAgents.length === 0) {
      throw new ServiceUnavailableException(
        ErrorCode.AGENT_NOT_FOUND,
        'Linked agent not found for single-agent stream',
      );
    }

    await this.resolveAgentBrainContexts(grpcAgents);

    const conversation = await this.conversationService.getConversationDocument(params.conversationId);
    const systemWorkspaceId = conversation.systemWorkspaceId?.toString();
    const [workspaceContexts, previousAttachedFiles] = await Promise.all([
      this.buildWorkspaceContexts(params.conversationId, logOpts, conversation),
      this.buildPreviousAttachedFiles(systemWorkspaceId, []),
    ]);

    const grpcRequest = {
      user_context: { user_id: params.userId, username: params.username || '' },
      conversation_id: params.conversationId,
      query: params.query,
      agent: grpcAgents[0],
      workspace_context: workspaceContexts.length
        ? workspaceContexts
        : [
            {
              workspace_id: params.conversationId,
              workspace_name: params.conversationId,
              workspace_documents: [],
            },
          ],
      attached_files: [],
      previous_attached_files: previousAttachedFiles,
    };

    const timeoutMs = this.configService.get<number>('conversation.grpcTimeoutMs', 120000);
    this.logger.log('RunSingleAgent gRPC request prepared', {
      conversationId: params.conversationId,
      messageId: params.messageId,
      agentId: params.agentId,
      agentName: grpcAgents[0].name,
      model: grpcAgents[0].chatbot?.model,
      toolCount: grpcAgents[0].tools?.length ?? 0,
      workspaceCount: grpcRequest.workspace_context.length,
      requestId: params.requestId,
    }, logOpts);

    return this.executeSingleAgentGrpcStream(params.messageId, grpcRequest, timeoutMs, logOpts);
  }

  private executeSingleAgentGrpcStream(
    messageId: string,
    grpcRequest: Record<string, unknown>,
    timeoutMs: number,
    logOpts?: LogOptions,
  ): Promise<{ durationMs: number; componentCount: number; chunkCount: number }> {
    return new Promise((resolve, reject) => {
      const metadata = createGrpcMetadata(this.configService);
      const username =
        (grpcRequest.user_context as { username?: string } | undefined)?.username || 'SYSTEM';
      metadata.set('user', username);

      const call = this.chatbotClient.RunSingleAgent(grpcRequest, metadata);
      const buffer = new Map<string, MessageComponent>();
      const startTime = Date.now();
      let chunkCount = 0;
      let timeoutHandle: NodeJS.Timeout | null = null;

      const resetIdleTimeout = () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        timeoutHandle = setTimeout(() => {
          this.logger.error('RunSingleAgent idle timeout', {
            messageId,
            chunkCount,
            timeoutMs,
            requestId: logOpts?.requestId,
          });
          call.cancel();
          void this.messageService.markStreamFailed(messageId).catch((err) => {
            this.logger.error('Failed to mark single-agent stream as failed', {
              messageId,
              error: (err as Error).message,
            });
          });
          reject(new Error('RunSingleAgent idle timeout'));
        }, timeoutMs);
      };

      resetIdleTimeout();

      call.on('data', (chunk: { action?: string; component?: Record<string, unknown> }) => {
        resetIdleTimeout();
        chunkCount++;

        const action = chunk.action;
        const comp = chunk.component;
        if (!comp?.id || !action) {
          return;
        }
        if (action === 'delete') {
          buffer.delete(comp.id as string);
          return;
        }
        if (action === 'add' || action === 'update') {
          this.applyChunkToBuffer(buffer, action, comp);
        }
      });

      call.on('error', (error: Error) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        this.logger.error('RunSingleAgent gRPC stream error', {
          messageId,
          error: error.message,
          chunkCount,
          requestId: logOpts?.requestId,
        });
        void this.messageService.markStreamFailed(messageId).catch((err) => {
          this.logger.error('Failed to mark single-agent stream as failed', {
            messageId,
            error: (err as Error).message,
          });
        });
        reject(error);
      });

      call.on('end', () => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        const durationMs = Date.now() - startTime;
        const components = Array.from(buffer.values());

        void this.messageService
          .completeAIMessage({ messageId, components, durationMs })
          .then(() => {
            resolve({ durationMs, componentCount: components.length, chunkCount });
          })
          .catch((error) => {
            reject(error);
          });
      });
    });
  }
}
