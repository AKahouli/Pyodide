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
import {
  CONVERSATION_EXECUTION_STORE,
  ConversationExecutionStore,
} from '../persistence/conversation-execution-store';
import { MessageComponent, ComponentType, type ConversationClientContextV1, type CorrectionReplayContext, type MessageReplayContext } from '../interfaces/message.interface';
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
import { WorkspaceShareService } from '../../workspace/workspace-share.service';
import { RunCodeSourceScopeService } from '../../workspace/services/run-code-source-scope.service';
import type { RunCodeAttachmentSource } from '../../workspace/interfaces/run-code-source.interface';
import { DocumentStatus } from '../../workspace/schemas/workspace-document.schema';
import { AgentService } from '../../agent/agent.service';
import { IGrpcAgent, IGrpcCompaction, IGrpcWorkspaceContext } from '../../agent/interfaces/agent.interface';
import { ModelsService } from '../../models/models.service';
import { SkillService } from '../../skill/skill.service';
import {
  buildGrpcChannelCredentials,
  createGrpcMetadata,
} from '../../../common/grpc/grpc-security.util';
import { randomUUID } from 'node:crypto';
import { ResponseReliabilityService } from './response-reliability.service';
import { ConversationAgentRequestBuilder, type BuiltAgentExecutionRequest } from './conversation-agent-request.builder';
import { SemanticModelService } from '../../semantic-model/services/semantic-model.service';
import { PLATFORM_COPILOT } from '../../agent/constants/platform-copilot.constants';
import { ConversationSettingsService } from '../../system/conversation-settings.service';
import type {
  ConversationLatencyMetricsV1,
  ConversationLatencyStartContext,
  StreamChunkLatencyData,
} from '../interfaces/latency.interface';
import { LatencyEnvelopeTracker } from '../utils/latency-metrics';
import {
  beginBackendPreAdkStage,
  endBackendPreAdkStage,
  getBackendPreAdkTracker,
  markGrpcDispatchedForLatency,
} from '../utils/backend-latency-tracker';

export interface StreamRequest {
  content: string;
  taskSummary?: string;
  attachedFileIds?: string[];
  webSearchEnabled?: boolean;
  webConnectorAccessEnabled?: boolean;
  deepSearchEnabled?: boolean;
  modelId?: string;
  semanticModelId?: string;
  reasoningEffort?: string;
  agentIds?: string[];
  connectorRepo?: {
    connectorId: string;
    connectorName: string;
    repoId: string;
    repoName: string;
    repoUrl?: string;
  };
  skillIds?: string[];
  clientContext?: ConversationClientContextV1;
  playbookHandoffId?: string;
}

export interface StreamGovernanceOverride {
  runtimeMode: 'governed';
  primaryAgentId: string;
  allowedAgentIds: string[];
  workspaceIds: string[];
  revisionId: string;
  scopeId: string;
}

export interface ConversationHistoryEntry {
  role: 'CONVERSATION_HISTORY_ROLE_USER' | 'CONVERSATION_HISTORY_ROLE_ASSISTANT';
  text: string;
}

export interface ActiveStreamSnapshot {
  conversationId: string;
  messageId: string;
  revision: number;
  components: MessageComponent[];
}

interface StreamTerminalCoordinator {
  started: boolean;
  settlement: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
  cancelIdleTimeout?: () => void;
}

@Injectable()
export class StreamService implements OnModuleInit, OnModuleDestroy {
  private chatbotClient: any;
  private isGrpcAvailable = false;
  private lastError: string | null = null;
  private lastCheckedAt?: Date;
  private activeStreams = new Map<string, Set<string>>(); // userId -> Set<conversationId>
  private activeConversationExecutions = new Set<string>(); // conversation-level exclusivity across actors
  private bootstrapCancelRequested = new Set<string>(); // streamKey -> stop during bootstrap
  private readonly fleetAdmissionEnabled: boolean;
  private readonly replicaId: string | null;
  private componentBuffers = new Map<string, Map<string, MessageComponent>>(); // streamKey -> (componentId -> accumulated component)
  private streamRevisions = new Map<string, number>(); // streamKey -> latest component-buffer revision
  private activeCalls = new Map<string, grpc.ClientReadableStream<any>>(); // streamKey -> gRPC call
  private streamExecutionLeases = new Map<string, string>(); // streamKey -> durable lease token
  private streamTerminalCoordinators = new Map<string, StreamTerminalCoordinator>();
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
    private readonly workspaceShareService: WorkspaceShareService,
    private readonly runCodeSourceScopeService: RunCodeSourceScopeService,
    private readonly agentService: AgentService,
    private readonly modelsService: ModelsService,
    private readonly skillService: SkillService,
    private readonly responseReliabilityService: ResponseReliabilityService,
    private readonly agentRequestBuilder: ConversationAgentRequestBuilder,
    private readonly conversationSettings: ConversationSettingsService,
    private readonly semanticModelService: SemanticModelService,
    @Inject(CONVERSATION_EXECUTION_STORE)
    private readonly executionStore: ConversationExecutionStore,
  ) {
    this.logger.setContext('StreamService');
    this.fleetAdmissionEnabled = this.configService.get<boolean>(
      'conversation.fleetAdmissionEnabled',
      true,
    );
    this.replicaId = this.configService.get<string>('REPLICA_ID') || null;
  }

  async seedConversationSession(
    userId: string,
    sessionId: string,
    idempotencyKey: string,
    history: ConversationHistoryEntry[],
  ): Promise<void> {
    await this.callConversationSessionRpc('SeedConversationSession', {
      user_id: userId,
      session_id: sessionId,
      idempotency_key: idempotencyKey,
      history,
    });
  }

  async deleteConversationSession(userId: string, sessionId: string, idempotencyKey: string): Promise<void> {
    await this.callConversationSessionRpc('DeleteConversationSession', {
      user_id: userId,
      session_id: sessionId,
      idempotency_key: idempotencyKey,
    });
  }

  private async callConversationSessionRpc(method: string, request: Record<string, unknown>): Promise<void> {
    if (!this.isGrpcAvailable || !this.chatbotClient) {
      throw new ServiceUnavailableException(
        ErrorCode.CHAT_GRPC_UNAVAILABLE,
        'AI service is currently unavailable',
      );
    }

    const metadata = createGrpcMetadata(this.configService);
    const deadline = new Date(Date.now() + this.configService.get<number>('conversation.grpcTimeoutMs', 120000));
    await new Promise<void>((resolve, reject) => {
      this.chatbotClient[method](request, metadata, { deadline }, (error: grpc.ServiceError | null) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  onModuleInit() {
    this.initGrpcClient();
  }

  async onModuleDestroy(): Promise<void> {
    // Cancel all active gRPC calls
    for (const [, call] of this.activeCalls) {
      call.cancel();
    }
    this.activeCalls.clear();

    for (const [streamKey, buffer] of this.componentBuffers) {
      const [, conversationId, messageId] = streamKey.split(':');
      if (messageId && buffer.size > 0) {
        try {
          await this.finalizeRunningTools(buffer, 'stopped', conversationId, [], { broadcast: false });
          await this.messageService.completeAIMessage({
            messageId,
            components: Array.from(buffer.values()),
          });
        } catch (err) {
          this.logger.error('Failed to persist buffer on shutdown', {
            messageId,
            error: (err as Error).message,
          });
        }
      }
    }

    this.activeStreams.clear();
    this.activeConversationExecutions.clear();
    this.bootstrapCancelRequested.clear();
    this.streamExecutionLeases.clear();
    this.streamTerminalCoordinators.clear();
    this.componentBuffers.clear();
    this.streamRevisions.clear();
    this.streamUsage.clear();

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
            filename: doc.originalName || doc.filename || '',
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
    governanceOverride?: StreamGovernanceOverride,
    latencyStart?: ConversationLatencyStartContext,
  ): Promise<void> {
    const logOpts: LogOptions = { requestId };
    // Stream bootstrap: entry (latency setting sample included) until the
    // agent execution request build starts.
    beginBackendPreAdkStage('streamBootstrapMs');
    // Admin-managed switch (Admin > Conversation). When off, the trace context
    // is not forwarded to ADK, so no envelope returns and nothing is persisted.
    const latencyInstrumentationEnabled = await this.conversationSettings.isLatencyInstrumentationEnabled();

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
      await this.sendErrorEvent(userId, conversationId, messageId, ErrorCode.CHAT_GRPC_UNAVAILABLE);
      throw new ServiceUnavailableException(
        ErrorCode.CHAT_GRPC_UNAVAILABLE,
        'AI service is currently unavailable',
      );
    }
    const leaseId = randomUUID();
    const leaseDurationMs = 90_000;
    const claimed = await this.messageService.claimStreamExecution(messageId, leaseId, leaseDurationMs);
    if (!claimed) {
      throw new ConflictException(
        ErrorCode.CHAT_ALREADY_STREAMING,
        'This response is already streaming',
      );
    }
    // Owned execution identity for the whole lifecycle (bootstrap through
    // terminal persistence). Local cleanup keys off this identity.
    const streamKey = `${userId}:${conversationId}:${messageId}`;
    // Terminal coordinator exists from bootstrap so a stop that arrives before
    // the gRPC dispatch shares exactly one settlement with end/error paths.
    this.createStreamTerminalCoordinator(streamKey);
    let leaseHeartbeat: ReturnType<typeof setInterval> | undefined;
    let leaseLost = false;
    // Ownership marker set once the conversation slot is granted: a rejected
    // duplicate must never release the legitimate owner's registration.
    let registeredLocally = false;
    // Set once the shared fleet admission slot is granted (WP07).
    let fleetAdmitted = false;
    try {
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
      await this.sendErrorEvent(userId, conversationId, messageId, ErrorCode.CHAT_STREAM_LIMIT);
      throw new AppException({
        code: ErrorCode.CHAT_STREAM_LIMIT,
        message: 'Maximum concurrent streams reached',
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
      });
    }

    // Check if conversation already streaming
    if (userStreams?.has(conversationId)) {
      this.logger.warn('Conversation already streaming', { conversationId }, logOpts);
      await this.sendErrorEvent(userId, conversationId, messageId, ErrorCode.CHAT_ALREADY_STREAMING);
      throw new ConflictException(
        ErrorCode.CHAT_ALREADY_STREAMING,
        'This conversation is already streaming',
      );
    }

    // Same-conversation execution is exclusive across ACTORS, not just per
    // user: group members must not concurrently mutate the same ADK session.
    if (this.activeConversationExecutions.has(conversationId)) {
      this.logger.warn('Conversation already streaming for another member', { conversationId }, logOpts);
      await this.sendErrorEvent(userId, conversationId, messageId, ErrorCode.CHAT_ALREADY_STREAMING);
      throw new ConflictException(
        ErrorCode.CHAT_ALREADY_STREAMING,
        'This conversation is already streaming',
      );
    }

    // Register active stream — after every admission guard, so a rejected
    // duplicate leaves no ghost registration behind.
    if (!this.activeStreams.has(userId)) {
      this.activeStreams.set(userId, new Set());
    }
    this.activeStreams.get(userId)!.add(conversationId);
    this.activeConversationExecutions.add(conversationId);
    this.streamExecutionLeases.set(streamKey, leaseId);
    registeredLocally = true;

    // Fleet admission (WP07): shared per-user/global capacity plus durable
    // same-conversation exclusivity across actors AND replicas. A missing
    // admission table (migration pending) degrades to process-local limits.
    if (this.fleetAdmissionEnabled) {
      const admitted = await this.executionStore.admit({
        executionId: randomUUID().replaceAll('-', '').slice(0, 24),
        conversationId,
        userId,
        messageId,
        ownerReplicaId: this.replicaId,
        expiresAt: new Date(Date.now() + leaseDurationMs * 2),
        maxActiveRunsPerUser: maxStreams,
        maxActiveRunsFleet: this.configService.get<number>('conversation.fleetMaxActiveRuns', 50),
      });
      if (!admitted.admitted) {
        if (admitted.reason === 'capacity') {
          this.logger.warn('Fleet admission rejected: capacity full', { userId, conversationId }, logOpts);
          await this.sendErrorEvent(userId, conversationId, messageId, ErrorCode.CHAT_STREAM_LIMIT);
          throw new AppException({
            code: ErrorCode.CHAT_STREAM_LIMIT,
            message: 'Maximum concurrent generations reached, please retry shortly',
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
          });
        }
        this.logger.warn('Fleet admission rejected: execution conflict', {
          userId,
          conversationId,
          reason: admitted.reason,
        }, logOpts);
        await this.sendErrorEvent(userId, conversationId, messageId, ErrorCode.CHAT_ALREADY_STREAMING);
        throw new ConflictException(
          ErrorCode.CHAT_ALREADY_STREAMING,
          'This conversation is already streaming',
        );
      }
      fleetAdmitted = true;
    }

    const assertLeaseOwned = () => {
      if (leaseLost) {
        throw new ConflictException(ErrorCode.CHAT_ALREADY_STREAMING, 'Stream execution lease was lost');
      }
      if (this.bootstrapCancelRequested.has(streamKey)) {
        throw new ConflictException(ErrorCode.CHAT_STREAM_FAILED, 'Stream was cancelled during bootstrap');
      }
    };
    leaseHeartbeat = setInterval(() => {
      void this.messageService.renewStreamExecution(messageId, leaseId, leaseDurationMs)
        .then((renewed) => {
          if (!renewed) {
            leaseLost = true;
            this.activeCalls.get(streamKey)?.cancel();
          }
        })
        .catch((error: unknown) => {
          leaseLost = true;
          this.activeCalls.get(streamKey)?.cancel();
          this.logger.error('Stream execution lease renewal failed', {
            conversationId,
            messageId,
            error: error instanceof Error ? error.message : String(error),
          }, logOpts);
        });
      if (fleetAdmitted) {
        // Keep the shared capacity slot alive and observe cross-replica stop
        // requests (bounded polling fallback; the serving replica settles).
        void this.executionStore
          .extendExpiry(messageId, new Date(Date.now() + leaseDurationMs * 2))
          .then(() => this.executionStore.isCancelRequested(messageId))
          .then((cancelRequested) => {
            if (cancelRequested) {
              this.logger.log('Remote stop observed for owned execution', { conversationId, messageId }, logOpts);
              void this.stopStream(userId, conversationId, messageId).catch(() => undefined);
            }
          })
          .catch(() => undefined);
      }
    }, 30_000);
    leaseHeartbeat.unref?.();
    this.componentBuffers.set(streamKey, new Map());
    this.streamRevisions.set(streamKey, 0);
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
    assertLeaseOwned();

    // Send stream_start event to all members
    await this.streamGateway.broadcastToConversation(
      memberIds, {
      type: 'stream_start',
      data: { conversationId, messageId },
    });
    assertLeaseOwned();

    endBackendPreAdkStage('streamBootstrapMs');
    const builtRequest = await this.buildAgentExecutionRequest(
      userId,
      conversationId,
      {
        content: request.content,
        taskSummary: request.taskSummary,
        attachedFileIds: request.attachedFileIds ?? [],
        webSearchEnabled: request.webSearchEnabled ?? false,
        webConnectorAccessEnabled: request.webConnectorAccessEnabled ?? true,
        deepSearchEnabled: request.deepSearchEnabled ?? false,
        modelId: request.modelId,
        semanticModelId: request.semanticModelId,
        agentIds: request.agentIds ?? [],
        skillIds: request.skillIds ?? [],
        connectorRepo: request.connectorRepo,
        clientContext: request.clientContext,
        playbookHandoffId: request.playbookHandoffId,
        governanceOverride,
      },
      username,
      undefined,
      logOpts,
      conversationId,
      messageId,
    );
    assertLeaseOwned();
    if (!await this.messageService.renewStreamExecution(messageId, leaseId, leaseDurationMs)) {
      leaseLost = true;
      assertLeaseOwned();
    }
    const useSingleAgent = builtRequest.rpc === 'RunSingleAgent';
    const grpcRequest = builtRequest.payload;

    const timeoutMs = this.configService.get<number>('conversation.grpcTimeoutMs', 120000);
    this.logger.debug(
      'gRPC request prepared',
      {
        streamKey,
        conversationId,
        messageId,
        rpc: builtRequest.rpc,
        timeoutMs,
      },
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
        latencyStart,
        latencyInstrumentationEnabled,
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
    } catch (error) {
      if ((error as { code?: ErrorCode }).code !== ErrorCode.CHAT_ALREADY_STREAMING) {
        // Ownership-checked and best-effort: a failing database must not mask
        // the original failure nor skip local cleanup below. The recovery
        // worker reclaims un-finalized attempts.
        await this.messageService.markStreamFailed(messageId, leaseId).catch((markError: unknown) => {
          this.logger.error('Failed to mark stream failed during cleanup', {
            conversationId,
            messageId,
            error: markError instanceof Error ? markError.message : String(markError),
          }, logOpts);
        });
      }
      throw error;
    } finally {
      if (leaseHeartbeat) clearInterval(leaseHeartbeat);
      if (fleetAdmitted) {
        // Release the shared capacity slot, mirroring the message's durable
        // terminal state. Best-effort: expired rows are reclaimed by the
        // recovery worker, so a failed finalize cannot leak the slot forever.
        await this.executionStore.finalizeByMessage(messageId).catch((finalizeError: unknown) => {
          this.logger.error('Failed to finalize fleet admission row', {
            conversationId,
            messageId,
            error: finalizeError instanceof Error ? finalizeError.message : String(finalizeError),
          }, logOpts);
        });
      }
      // Durable release is ownership-checked and best-effort; its failure
      // must not leak the lease map entry or the local execution slots.
      await this.messageService.releaseStreamExecution(messageId, leaseId).catch((releaseError: unknown) => {
        this.logger.error('Failed to release stream execution lease', {
          conversationId,
          messageId,
          error: releaseError instanceof Error ? releaseError.message : String(releaseError),
        }, logOpts);
      });
      // Local cleanup never depends on database success (idempotent with the
      // terminal/gRPC paths that may have cleaned up earlier).
      this.bootstrapCancelRequested.delete(streamKey);
      for (const [key, activeLeaseId] of this.streamExecutionLeases) {
        if (activeLeaseId === leaseId) this.streamExecutionLeases.delete(key);
      }
      if (registeredLocally) {
        this.cleanupStream(userId, conversationId, streamKey);
      } else {
        // Rejected before registration: release only this execution's own
        // handle, never the conversation slot owned by another execution.
        this.componentBuffers.delete(streamKey);
        this.streamRevisions.delete(streamKey);
        this.streamUsage.delete(streamKey);
        this.streamTerminalCoordinators.delete(streamKey);
      }
    }
  }

  private async buildRunCodeAttachmentSources(
    attachedFileIds: string[],
  ): Promise<RunCodeAttachmentSource[]> {
    if (attachedFileIds.length === 0) return [];
    const documents = await this.workspaceDocumentService.findByIds(attachedFileIds);
    return documents.flatMap((document) =>
      document.workspaceId && document.path
        ? [{ workspaceId: document.workspaceId, path: document.path }]
        : [],
    );
  }

  isConversationStreaming(userId: string, conversationId: string): boolean {
    return this.activeStreams.get(userId)?.has(conversationId) ?? false;
  }

  getActiveStreamSnapshot(conversationId: string): ActiveStreamSnapshot | null {
    for (const [streamKey, buffer] of this.componentBuffers) {
      const [, activeConversationId, messageId] = streamKey.split(':');
      if (activeConversationId !== conversationId || !messageId) continue;

      return {
        conversationId,
        messageId,
        revision: this.streamRevisions.get(streamKey) ?? 0,
        components: Array.from(buffer.values(), (component) => this.sanitizeComponent(component)),
      };
    }

    return null;
  }

  async buildAgentExecutionRequest(
    userId: string,
    conversationId: string,
    request: MessageReplayContext,
    username?: string,
    correctionReplayContext?: CorrectionReplayContext,
    logOpts: LogOptions = {},
    sessionId = conversationId,
    runtimeCorrelationId = sessionId,
  ): Promise<BuiltAgentExecutionRequest> {
    beginBackendPreAdkStage('conversationContextLoadMs');
    const conversation = await this.conversationService.getConversationDocument(conversationId);
    const systemWorkspaceId = conversation.systemWorkspaceId;
    const groupMembers = conversation.isGroup
      ? await this.conversationService.getGroupMembers(conversationId)
      : [];
    endBackendPreAdkStage('conversationContextLoadMs');
    const sharedAgentIds = conversation.isGroup ? conversation.groupTaggedAgentIds : [];
    const governanceOverride = request.governanceOverride;
    const requestedGovernedAgentIds = governanceOverride
      ? (request.agentIds.length ? request.agentIds : [governanceOverride.primaryAgentId])
      : undefined;
    // Admin-configured compaction default, sent to the engine on every chat
    // request; the engine derives token_threshold from token_fraction * context
    // window. Omitted when disabled, so the engine keeps its no-compaction path.
    const compactionSettings = (await this.conversationSettings.getSettings()).compaction;
    const compaction: IGrpcCompaction | undefined = compactionSettings?.enabled
      ? {
        enabled: true,
        compaction_interval: compactionSettings.compactionInterval,
        overlap_size: compactionSettings.overlapSize,
        token_fraction: compactionSettings.tokenFraction,
        event_retention_size: compactionSettings.eventRetentionSize,
        summarizer_model: compactionSettings.summarizerModel ?? '',
      }
      : undefined;
    beginBackendPreAdkStage('workspaceAgentResolutionMs');
    const semanticSchemaName = request.semanticModelId
      ? await this.semanticModelService.resolveSearchSchema(userId, request.semanticModelId)
      : undefined;
    const [workspaceContexts, agents] = await Promise.all([
      request.semanticModelId ? Promise.resolve([]) : this.buildWorkspaceContexts(conversationId, logOpts, conversation),
      governanceOverride
        ? this.agentService.buildGovernedAgentsForStream(userId, requestedGovernedAgentIds ?? [], governanceOverride.workspaceIds)
        : this.agentService.buildAgentsForStream(
          userId,
          request.modelId,
          request.agentIds,
          sharedAgentIds,
          groupMembers,
          request.connectorRepo?.connectorId,
          semanticSchemaName,
          conversation.runtimePurpose === PLATFORM_COPILOT ? {
            conversationId,
            correlationId: runtimeCorrelationId,
            playbookHandoffAttached: Boolean(request.playbookHandoffId),
          } : undefined,
          request.reasoningEffort,
          compaction,
          request.webConnectorAccessEnabled,
        ),
    ]);
    endBackendPreAdkStage('workspaceAgentResolutionMs');
    if (conversation.runtimePurpose === PLATFORM_COPILOT) {
      const pinnedAgentId = conversation.pinnedAgentId?.toString();
      if (!pinnedAgentId || agents.length !== 1 || agents[0]?.id !== pinnedAgentId) {
        throw new ServiceUnavailableException(
          ErrorCode.AGENT_UNAVAILABLE,
          'Yellowmind must resolve exactly one pinned platform copilot agent',
        );
      }
    }
    beginBackendPreAdkStage('supplementalContextAssemblyMs');
    const [, attachedFiles, previousAttachedFiles, skills, currentAttachmentSources] = await Promise.all([
      this.resolveAgentBrainContexts(agents),
      this.buildAttachedFiles(request.attachedFileIds),
      this.buildPreviousAttachedFiles(systemWorkspaceId, request.attachedFileIds),
      request.skillIds.length ? this.skillService.findByIdsForGrpc(request.skillIds) : Promise.resolve([]),
      this.buildRunCodeAttachmentSources(request.attachedFileIds),
    ]);
    await this.attachRunCodeContexts(
      agents,
      userId,
      runtimeCorrelationId,
      workspaceContexts.map((context) => context.workspace_id),
      [
        ...currentAttachmentSources,
        ...previousAttachedFiles.flatMap((file) =>
          file.workspace_id && file.filepath
            ? [{ workspaceId: file.workspace_id, path: file.filepath }]
            : [],
        ),
      ],
    );
    endBackendPreAdkStage('supplementalContextAssemblyMs');
    beginBackendPreAdkStage('grpcPayloadPreparationMs');
    return this.agentRequestBuilder.build({
      userId,
      username,
      conversationId: sessionId,
      request,
      workspaceContexts,
      agents,
      attachedFiles,
      previousAttachedFiles,
      skills,
      correctionReplayContext,
    });
  }

  private async attachRunCodeContexts(
    agents: IGrpcAgent[],
    userId: string,
    runId: string,
    selectedWorkspaceIds: string[],
    attachments: RunCodeAttachmentSource[] = [],
  ): Promise<void> {
    const eligibleAgents = agents.filter((agent) =>
      agent.tools.some((tool) => tool.name === 'run_code'),
    );
    if (eligibleAgents.length === 0) return;

    const uniqueAttachmentWorkspaceIds = [...new Set(
      attachments.map((attachment) => attachment.workspaceId).filter(Boolean),
    )];
    await this.workspaceShareService.assertUserHasAccess(
      userId,
      [...new Set([...selectedWorkspaceIds.filter(Boolean), ...uniqueAttachmentWorkspaceIds])],
    );
    await Promise.all(eligibleAgents.map(async (agent) => {
      const sources = await this.runCodeSourceScopeService.buildSources(
        [...new Set([
          ...selectedWorkspaceIds.filter(Boolean),
          ...agent.brain_context.map((context) => context.workspace_id).filter(Boolean),
        ])],
        attachments,
      );
      agent.agent_params ??= { params: {} };
      agent.agent_params.params.run_code_context_json = JSON.stringify({ userId, runId, sources });
    }));
  }

  executePrivateAgentRequest(
    builtRequest: BuiltAgentExecutionRequest,
    timeoutMs: number,
    username?: string,
  ): {
    started: Promise<void>;
    result: Promise<{ components: MessageComponent[]; usage: { inputTokens: number; outputTokens: number; model?: string; durationMs: number } }>;
  } {
    if (!this.isGrpcAvailable || !this.chatbotClient) {
      throw new ServiceUnavailableException(ErrorCode.CHAT_GRPC_UNAVAILABLE, 'AI service is currently unavailable');
    }
    let resolveStarted!: () => void;
    let rejectStarted!: (error: Error) => void;
    const started = new Promise<void>((resolve, reject) => {
      resolveStarted = resolve;
      rejectStarted = reject;
    });
    let acknowledged = false;
    const metadata = createGrpcMetadata(this.configService);
    metadata.set('user', username || 'SYSTEM');
    let call: grpc.ClientReadableStream<any>;
    try {
      call = this.chatbotClient[builtRequest.rpc](builtRequest.payload, metadata);
    } catch (error) {
      const transportError = error instanceof Error ? error : new Error(String(error));
      rejectStarted(transportError);
      return { started, result: Promise.reject(transportError) };
    }
    const result = new Promise<{ components: MessageComponent[]; usage: { inputTokens: number; outputTokens: number; model?: string; durationMs: number } }>((resolve, reject) => {
      const buffer = new Map<string, MessageComponent>();
      const started = Date.now();
      let inputTokens = 0;
      let outputTokens = 0;
      let model: string | undefined;
      let settled = false;
      let timeoutHandle: NodeJS.Timeout;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        if (error) {
          if (!acknowledged) rejectStarted(error);
          reject(error);
        }
        else resolve({
          components: Array.from(buffer.values()),
          usage: { inputTokens, outputTokens, model, durationMs: Date.now() - started },
        });
      };
      const resetTimeout = () => {
        clearTimeout(timeoutHandle);
        timeoutHandle = setTimeout(() => {
          call.cancel();
          finish(new Error('corrective_replay_timeout'));
        }, timeoutMs);
      };
      resetTimeout();
      call.on('data', (chunk: any) => {
        resetTimeout();
        if (chunk.action === 'replay_started' && !acknowledged) {
          acknowledged = true;
          resolveStarted();
          return;
        }
        const component = chunk.component;
        if (component?.id && ['add', 'update', 'delete'].includes(chunk.action)) {
          if (chunk.action === 'delete') buffer.delete(component.id);
          else this.applyChunkToBuffer(buffer, chunk.action, component);
        }
        if (chunk.usage) {
          inputTokens += chunk.usage.input_tokens || 0;
          outputTokens += chunk.usage.output_tokens || 0;
          model = chunk.usage.model || model;
        }
      });
      call.on('error', (error: Error) => finish(error));
      call.on('end', () => finish(acknowledged ? undefined : new Error('corrective_replay_not_started')));
    });
    return { started, result };
  }

  async stopStream(userId: string, conversationId: string, messageId: string): Promise<void> {
    const streamKey = `${userId}:${conversationId}:${messageId}`;

    this.logger.debug('Stream stop requested', {
      userId,
      conversationId,
      messageId,
      streamKey,
    });

    const existingTerminal = this.streamTerminalCoordinators.get(streamKey);
    if (existingTerminal?.started) {
      await existingTerminal.settlement;
      return;
    }

    const call = this.activeCalls.get(streamKey);
    if (!call) {
      // Stop during bootstrap: the gRPC call does not exist yet, but the
      // execution does (lease/terminal were registered at admission). Signal
      // cancellation so preparation aborts and dispatch is prevented, and
      // settle through the same terminal coordinator.
      const leaseId = this.streamExecutionLeases.get(streamKey);
      if (!leaseId) {
        // Cross-replica stop (WP07): record the control intent on the shared
        // execution row so the owning replica observes and settles it.
        if (this.fleetAdmissionEnabled) {
          const requested = await this.executionStore.requestCancel(messageId).catch(() => false);
          if (requested) {
            this.logger.log('Stop requested for remotely owned execution', {
              userId,
              conversationId,
              messageId,
            });
            return;
          }
        }
        this.logger.warn('No active stream found for stop request', { streamKey });
        throw new AppException({
          code: ErrorCode.CHAT_STREAM_FAILED,
          message: 'No active stream found',
          statusCode: HttpStatus.NOT_FOUND,
        });
      }

      this.bootstrapCancelRequested.add(streamKey);
      // Capture the coordinator before settlement: the operation's cleanup
      // removes it from the map, but the stop caller still awaits settlement.
      const bootstrapTerminal = this.streamTerminalCoordinators.get(streamKey);
      const claimedTerminal = this.beginStreamTerminal(streamKey, async () => {
        try {
          // Ownership-checked: only the owning attempt is marked; safe to run
          // even if bootstrap fails concurrently.
          await this.messageService.markStreamFailed(messageId, leaseId);
          this.streamGateway.sendToUser(userId, {
            type: 'stream_error',
            data: {
              conversationId,
              messageId,
              errorCode: ErrorCode.CHAT_STREAM_FAILED,
              message: 'Generation stopped before it started',
            },
          });
        } finally {
          this.cleanupStream(userId, conversationId, streamKey);
        }
      });
      if (claimedTerminal && bootstrapTerminal) {
        await bootstrapTerminal.settlement;
      }
      return;
    }

    const streamExecutionLeaseId = this.streamExecutionLeases.get(streamKey);
    const claimedTerminal = this.beginStreamTerminal(streamKey, async () => {
      try {
        // Persist current buffer
        const buffer = this.componentBuffers.get(streamKey) || new Map();
        await this.finalizeRunningTools(
          buffer,
          'stopped',
          conversationId,
          await this.resolveMemberIds(conversationId),
          { streamKey, messageId },
        );
        if (buffer.size > 0) {
          this.logger.debug('Persisting buffer on stop', {
            streamKey,
            bufferSize: buffer.size,
          });
        }
        try {
          await this.messageService.completeAIMessage({
            messageId,
            streamExecutionLeaseId,
            components: Array.from(buffer.values()),
          });
        } catch (err) {
          this.logger.error('Failed to persist buffer on stop', {
            messageId,
            error: (err as Error).message,
          });
          throw err;
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

        this.logger.debug('Stream stopped successfully', {
          streamKey,
          conversationId,
          messageId,
        });
      } finally {
        call.cancel();
        this.cleanupStream(userId, conversationId, streamKey);
      }
    });
    const terminal = this.streamTerminalCoordinators.get(streamKey) ?? existingTerminal;
    if (!claimedTerminal && !terminal) {
      throw new AppException({
        code: ErrorCode.CHAT_STREAM_FAILED,
        message: 'No active stream found',
        statusCode: HttpStatus.NOT_FOUND,
      });
    }
    await terminal!.settlement;
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
    latencyStart?: ConversationLatencyStartContext,
    latencyInstrumentationEnabled = true,
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
      // Latency correlation: both request messages carry latency_trace_context.
      // Gated by the admin setting; when off, ADK installs no trace and the
      // rest of the chain stays inert.
      if (latencyInstrumentationEnabled && latencyStart?.assistantMessageId) {
        grpcRequest.latency_trace_context = {
          schema_version: 1,
          request_id: latencyStart.requestId,
          assistant_message_id: latencyStart.assistantMessageId,
          backend_received_epoch_ms: latencyStart.backendReceivedEpochMs,
        };
      }
      endBackendPreAdkStage('grpcPayloadPreparationMs');
      markGrpcDispatchedForLatency();
      if (this.bootstrapCancelRequested.has(streamKey)) {
        // Stop arrived during bootstrap: refuse dispatch, zero upstream calls.
        throw new ConflictException(
          ErrorCode.CHAT_STREAM_FAILED,
          'Stream was cancelled during bootstrap',
        );
      }
      const call = useSingleAgent
        ? this.chatbotClient.RunSingleAgent(grpcRequest, metadata)
        : this.chatbotClient.RunAgentTeam(grpcRequest, metadata);
      // Reuse the coordinator created at admission so stop/end/error share
      // exactly one terminal settlement.
      const terminal = this.streamTerminalCoordinators.get(streamKey)
        ?? this.createStreamTerminalCoordinator(streamKey);
      this.activeCalls.set(streamKey, call);

      let totalInputTokens = 0;
      let totalOutputTokens = 0;
      let latestModelRequestTelemetry: { usedTokens: number; contextWindow: number; model: string } | undefined;
      let chunkCount = 0;
      const startTime = Date.now();
      let timeToFirstChunk: number | null = null;
      let timeToFirstToken: number | null = null;
      // Latency instrumentation: the ADK attaches its timing envelope to the
      // first post-model StreamChunk; it is parsed once and forwarded once.
      const latencyTracker = new LatencyEnvelopeTracker(
        latencyInstrumentationEnabled ? latencyStart : undefined,
      );
      let latencyMetrics: ConversationLatencyMetricsV1 | undefined;
      const takeLatencyEnvelope = (): StreamChunkLatencyData | undefined => {
        // Read before take(): the tracker clears the captured trace on take.
        const backendPreAdk = getBackendPreAdkTracker();
        const capturedTrace = latencyTracker.capturedTrace;
        const envelope = latencyTracker.take();
        if (envelope) {
          latencyMetrics = { schemaVersion: 1, ...envelope.metrics, quality: envelope.quality };
          const breakdown = backendPreAdk?.toBreakdown(capturedTrace ?? undefined);
          if (breakdown) {
            latencyMetrics.backendPreAdkBreakdown = breakdown;
            // The first-chunk envelope feeds the live popover too, not just
            // persistence — carry the breakdown on both.
            envelope.metrics.backendPreAdkBreakdown = breakdown;
          }
        }
        return envelope;
      };
      // Idle timeout - resets every time data is received
      let timeoutHandle: NodeJS.Timeout | null = null;
      terminal.cancelIdleTimeout = () => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
      };
      void terminal.settlement.then(resolve, reject);
      const resetIdleTimeout = () => {
        if (terminal.started) return;
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
          const timeoutError = new Error('Stream idle timeout - no data received');
          this.beginStreamTerminal(
            streamKey,
            async () => {
              call.cancel();
              await this.handleStreamError(
                userId,
                conversationId,
                messageId,
                streamKey,
                ErrorCode.CHAT_STREAM_TIMEOUT,
                requestId,
                latencyMetrics,
              );
            },
            timeoutError,
          );
        }, timeoutMs);
      };

      // Start the initial idle timeout
      resetIdleTimeout();

      call.on('data', (chunk: any) => {
        if (terminal.started) return;
        // Reset idle timeout on each chunk received
        resetIdleTimeout();
        if (chunk.action === 'heartbeat') return;
        chunkCount++;
        // Capture time to first chunk

        // Capture time to first
        if (chunkCount === 1) {
          timeToFirstChunk = Date.now() - startTime;
        }

        // Latency trace detection: capture the envelope; it is stamped onto
        // the SSE event for this same chunk right before broadcast.
        latencyTracker.capture(chunk);

        try {
          const action = chunk.action;
          const comp = chunk.component;
          const guardrailDecision = this.parseGuardrailDecision(chunk.metadata?.guardrail_decision_json);

          if (comp && comp.id && (action === 'add' || action === 'update' || action === 'delete')) {
            if (action === 'delete') {
              const buffer = this.componentBuffers.get(streamKey);
              if (buffer) {
                buffer.delete(comp.id);
              }

              // Send chunk immediately to frontend (only id needed for delete)
              const revision = this.nextStreamRevision(streamKey);
              const latencyData = takeLatencyEnvelope();
              this.streamGateway.broadcastToConversation(
                memberIds, {
                type: 'stream_chunk',
                data: {
                  conversationId,
                  messageId,
                  revision,
                  action,
                  component: { id: comp.id } as MessageComponent,
                  ...(latencyData ? { latency: latencyData } : {}),
                },
              }).catch((err) => {
                this.logger.error('Failed to broadcast delete chunk', { error: err.message, streamKey }, logOpts);
              });
            } else {
              const buffer = this.componentBuffers.get(streamKey);
              if (buffer) {
                this.applyChunkToBuffer(buffer, action, comp, guardrailDecision, chunk.metadata?.agent_id);
              }

              // Extract component type and data from oneof structure
              const { type, data } = this.extractComponentData(comp, chunk.metadata?.agent_id);
              if (guardrailDecision) {
                data.guardrailDecision = guardrailDecision;
              }

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
                if (type === 'text' && data?.content) {
                  timeToFirstToken = Date.now() - startTime;
                }
              }

              // Send chunk immediately to frontend
              const publicComponent = this.sanitizeComponent({ id: comp.id, type, data });
              const revision = this.nextStreamRevision(streamKey);
              // backend.first_delta_written boundary: stamped immediately
              // before the first model-derived event enters SSE fan-out.
              const latencyData = takeLatencyEnvelope();
              this.streamGateway.broadcastToConversation(
                memberIds, {
                type: 'stream_chunk',
                data: {
                  conversationId,
                  messageId,
                  revision,
                  action,
                  component: publicComponent,
                  ...(latencyData ? { latency: latencyData } : {}),
                },
              }).catch((err) => {
                this.logger.error('Failed to broadcast stream chunk', { error: err.message, streamKey }, logOpts);
              });
            }
          }

          // Track usage
          if (chunk.usage) {
            totalInputTokens += chunk.usage.input_tokens || 0;
            totalOutputTokens += chunk.usage.output_tokens || 0;
            if (chunk.usage.input_tokens > 0 && chunk.usage.context_window_tokens > 0 && chunk.usage.model) {
              latestModelRequestTelemetry = {
                usedTokens: chunk.usage.input_tokens,
                contextWindow: chunk.usage.context_window_tokens,
                model: chunk.usage.model,
              };
            }
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
        if (terminal.started) return;

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

        this.beginStreamTerminal(streamKey, async () => {
          try {
            const buffer = this.componentBuffers.get(streamKey) || new Map();
            await this.finalizeRunningTools(buffer, 'failed', conversationId, memberIds, { streamKey, messageId });
            const components = Array.from(buffer.values());

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
            streamExecutionLeaseId: this.streamExecutionLeases.get(streamKey),
            components,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            durationMs,
            timeToFirstChunk: timeToFirstChunk ?? undefined,
            timeToFirstToken: timeToFirstToken ?? undefined,
            modelRequestTelemetry: latestModelRequestTelemetry,
            latencyMetrics,
          });

          if (latencyMetrics) {
            // Single structured summary per completed request (never per token).
            this.logger.log('conversation_latency', {
              event: 'conversation_latency',
              schemaVersion: latencyMetrics.schemaVersion,
              requestId,
              conversationId,
              messageId,
              backendPreAdkMs: latencyMetrics.backendPreAdkMs,
              adkPreProviderMs: latencyMetrics.adkPreProviderMs,
              providerTtftMs: latencyMetrics.providerTtftMs,
              adkForwardingMs: latencyMetrics.adkForwardingMs,
              backendForwardingMs: latencyMetrics.backendForwardingMs,
              quality: latencyMetrics.quality,
            }, logOpts);
          }

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
              ...(latencyMetrics ? { latencyMetrics } : {}),
            },
          });

          // Informative evaluation starts only after users receive stream_complete.
          void this.responseReliabilityService.schedule({
            messageId,
            conversationId,
            userId,
            requestId,
          }).catch((error) => {
            this.logger.warn('Unable to schedule response reliability evaluation', {
              messageId,
              error: error instanceof Error ? error.message : String(error),
            }, logOpts);
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
            throw error;
          }
        });
      });

      call.on('error', (error: any) => {
        if (terminal.started) return;

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

        this.beginStreamTerminal(
          streamKey,
          () => this.handleStreamError(
            userId,
            conversationId,
            messageId,
            streamKey,
            errorCode,
            requestId,
            latencyMetrics,
          ),
          error,
        );
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
    latencyMetrics?: ConversationLatencyMetricsV1,
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
    await this.finalizeRunningTools(
      buffer,
      'failed',
      conversationId,
      await this.resolveMemberIds(conversationId),
      { streamKey, messageId },
    );

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
        streamExecutionLeaseId: this.streamExecutionLeases.get(streamKey),
        components: Array.from(buffer.values()),
        latencyMetrics,
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

    // Keep terminal ownership until the scoped error event has been delivered or logged.
    await this.sendErrorEvent(userId, conversationId, messageId, errorCode);
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

  private parseGuardrailDecision(value?: string): Record<string, unknown> | undefined {
    if (!value) return undefined;
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined;
    } catch (error) {
      this.logger.warn('Invalid guardrail decision metadata from stream', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return undefined;
    }
  }

  private async finalizeRunningTools(
    buffer: Map<string, MessageComponent>,
    status: 'failed' | 'stopped',
    conversationId: string,
    memberIds: string[],
    options: { streamKey?: string; messageId?: string; broadcast?: boolean } = {},
  ): Promise<void> {
    const completedAt = new Date().toISOString();
    for (const component of buffer.values()) {
      if (component.type !== 'toolActivity' || component.data.status !== 'running') continue;
      const startedAt = typeof component.data.startedAt === 'string' ? Date.parse(component.data.startedAt) : Number.NaN;
      component.data = {
        ...component.data,
        status,
        completedAt,
        ...(Number.isFinite(startedAt) ? { durationMs: Math.max(0, Date.now() - startedAt) } : {}),
      };
      if (options.broadcast !== false) {
        const revision = options.streamKey ? this.nextStreamRevision(options.streamKey) : undefined;
        try {
          await this.streamGateway.broadcastToConversation(memberIds, {
            type: 'stream_chunk',
            data: {
              conversationId,
              ...(options.messageId ? { messageId: options.messageId } : {}),
              ...(revision !== undefined ? { revision } : {}),
              action: 'update',
              component: this.sanitizeComponent(component),
            },
          });
        } catch (error) {
          this.logger.error('Failed to broadcast terminal tool update', {
            conversationId,
            messageId: options.messageId,
            componentId: component.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  private async sendErrorEvent(
    userId: string,
    conversationId: string,
    messageId: string,
    errorCode: ErrorCode,
  ): Promise<void> {
    try {
      const memberIds = await this.resolveMemberIds(conversationId);
      await this.streamGateway.broadcastToConversation(
        memberIds, {
        type: 'stream_error',
        data: {
          conversationId,
          messageId,
          errorCode,
          message: this.getErrorMessage(errorCode),
        },
      });
    } catch (error) {
      this.logger.error('Failed to broadcast stream error', {
        userId,
        conversationId,
        messageId,
        errorCode,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private cleanupStream(userId: string, conversationId: string, streamKey: string): void {
    this.activeCalls.delete(streamKey);
    this.componentBuffers.delete(streamKey);
    this.streamRevisions.delete(streamKey);
    this.streamUsage.delete(streamKey);
    this.streamTerminalCoordinators.delete(streamKey);
    this.activeConversationExecutions.delete(conversationId);
    const userStreams = this.activeStreams.get(userId);
    if (userStreams) {
      userStreams.delete(conversationId);
      if (userStreams.size === 0) {
        this.activeStreams.delete(userId);
      }
    }
  }

  private createStreamTerminalCoordinator(streamKey: string): StreamTerminalCoordinator {
    let resolve: () => void = () => undefined;
    let reject: (error: unknown) => void = () => undefined;
    const settlement = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    void settlement.catch(() => undefined);
    const terminal = { started: false, settlement, resolve, reject };
    this.streamTerminalCoordinators.set(streamKey, terminal);
    return terminal;
  }

  private beginStreamTerminal(
    streamKey: string,
    operation: () => Promise<void>,
    terminalError?: unknown,
  ): boolean {
    const terminal = this.streamTerminalCoordinators.get(streamKey);
    if (!terminal || terminal.started) return false;
    terminal.started = true;
    terminal.cancelIdleTimeout?.();
    void operation().then(
      () => terminalError === undefined ? terminal.resolve() : terminal.reject(terminalError),
      (error) => terminal.reject(error),
    );
    return true;
  }

  private nextStreamRevision(streamKey: string): number {
    const revision = (this.streamRevisions.get(streamKey) ?? 0) + 1;
    this.streamRevisions.set(streamKey, revision);
    return revision;
  }

  private getComponentType(comp: any): ComponentType {
    return sharedGetComponentType(comp);
  }

  private extractComponentData(comp: any, agentId?: string): { type: ComponentType; data: Record<string, unknown> } {
    return sharedExtractComponentData(comp, agentId);
  }

  /**
   * Applies a chunk to the component buffer.
   * - 'add': Creates a new component entry
   * - 'update': Merges data into existing component
   *
   * Type-specific behavior:
   * - text/code: Append to content string
   * - queue/plan/checkpoint/task: Replace entire data (arrives in one chunk)
   */
  private applyChunkToBuffer(
    buffer: Map<string, MessageComponent>,
    action: string,
    comp: any,
    guardrailDecision?: Record<string, unknown>,
    agentId?: string,
  ): void {
    const componentId = comp.id;
    const { type, data } = this.extractComponentData(comp, agentId);
    if (guardrailDecision) {
      data.guardrailDecision = guardrailDecision;
    }
    if (action === 'add') {
      const existing = buffer.get(componentId);
      if (existing && type === 'toolActivity') {
        existing.data = this.mergeComponentData(type, existing.data, data);
        return;
      }
      buffer.set(componentId, {
        id: componentId,
        type,
        data: { ...data },
      });
    } else if (action === 'update') {
      const existing = buffer.get(componentId);
      if (existing) {
        existing.data = this.mergeComponentData(type, existing.data, data);
        if (guardrailDecision) {
          existing.data.guardrailDecision = guardrailDecision;
        }
      } else if (type === 'toolActivity') {
        const merged = this.mergeComponentData(type, {}, data);
        buffer.set(componentId, { id: componentId, type, data: merged });
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
      {
        if (incoming.guardrailDecision) {
          return { ...existing, ...incoming };
        }
        // Append content for streaming text types
        const existingContent = (existing.content as string) || '';
        const newContent = (incoming.content as string) || '';
        return {
          ...existing,
          content: existingContent + newContent,
        };
      }
      case 'agentActivity':
        return { ...existing, ...incoming };
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
      case 'choice':
        // These arrive fully formed - replace with incoming data
        return { ...incoming };
      case 'toolActivity':
        // The 'update' chunk carries the final status (completed/failed) that
        // supersedes the initial 'running', but params (the tool-call args) are
        // only sent on the initial 'add' — preserve them when the update omits them.
        const existingStatus = (existing.status as string) || 'running';
        const incomingStatus = (incoming.status as string) || existingStatus;
        const existingIsTerminal = existingStatus === 'completed' || existingStatus === 'failed' || existingStatus === 'stopped';
        return {
          toolName: (incoming.toolName as string) || (existing.toolName as string) || '',
          displayKey: (incoming.displayKey as string) || (existing.displayKey as string) || '',
          fallbackDisplayName: (incoming.fallbackDisplayName as string) || (existing.fallbackDisplayName as string) || '',
          summary: (incoming.summary as string) || (existing.summary as string) || '',
          renderKind: (incoming.renderKind as string) || (existing.renderKind as string) || 'generic',
          status: existingIsTerminal ? existingStatus : incomingStatus,
          paramsJson: (incoming.paramsJson as string) || (existing.paramsJson as string) || '',
          startedAt: (incoming.startedAt as string) || (existing.startedAt as string) || '',
          completedAt: (incoming.completedAt as string) || (existing.completedAt as string) || '',
          durationMs: incoming.durationMs ?? existing.durationMs,
          resultJson: (incoming.resultJson as string) || (existing.resultJson as string) || '',
          actorId: (incoming.actorId as string) || (existing.actorId as string) || '',
          actorName: (incoming.actorName as string) || (existing.actorName as string) || '',
          primaryInput: (incoming.primaryInput as string) || (existing.primaryInput as string) || '',
          primaryInputLanguage: (incoming.primaryInputLanguage as string) || (existing.primaryInputLanguage as string) || '',
        };
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
    username?: string,
  ): void {
    // Fire and forget - don't await at call site
    this.generateConversationName(userId, conversationId, query, username).catch((err) => {
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
    username?: string,
  ): Promise<void> {
    try {
      // Naming model is admin-configurable (Paramètres de conversation). Use the
      // chosen model when set; otherwise fall back to the platform default.
      // An empty model makes the gRPC name generation fail and the conversation
      // keeps its default title.
      const { conversationName } = await this.conversationSettings.getSettings();
      const chosen = conversationName.modelId
        ? await this.modelsService.findById(conversationName.modelId).catch(() => null)
        : null;

      // Chosen models are served by the LiteLLM proxy, so route via the proxy
      // alias ("litellm_proxy/<model_name>"). Their stored litellmModel is a
      // provider-prefixed target (e.g. "ollama/gemma3:4b") that would bypass the
      // proxy and fail. The platform default keeps its litellmModel (unchanged).
      const litellmModel = chosen
        ? `litellm_proxy/${chosen.id}`
        : ((await this.modelsService.getDefaultModel())?.litellmModel || '');

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
    await this.attachRunCodeContexts(
      grpcAgents,
      params.userId,
      params.messageId,
      workspaceContexts.map((context) => context.workspace_id),
      previousAttachedFiles.flatMap((file) =>
        file.workspace_id && file.filepath
          ? [{ workspaceId: file.workspace_id, path: file.filepath }]
          : [],
      ),
    );

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
        if (chunk.action === 'heartbeat') return;
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

  private sanitizeComponent(component: MessageComponent): MessageComponent {
    // Conversation streams render exactly as stored — display-time
    // sanitization was removed by product decision. Public share snapshots
    // are still sanitized separately in ShareService.
    return component;
  }
}
