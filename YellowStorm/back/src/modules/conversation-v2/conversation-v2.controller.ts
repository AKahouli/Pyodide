import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  NotImplementedException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import * as grpc from '@grpc/grpc-js';
import { Public } from '@modules/auth/decorators/public.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { ConversationV2GrpcClientService } from './services/conversation-v2.grpc-client.service';
import { ConversationV2SessionService } from './services/conversation-v2-session.service';
import { ConversationV2ShareService } from './services/conversation-v2-share.service';
import { ConversationV2OwnerGuard } from './guards/conversation-v2-owner.guard';
import { ConversationV2SessionAccessGuard } from './guards/conversation-v2-session-access.guard';
import { RequireConversationSessionPermission } from './decorators/require-conversation-session-permission.decorator';
import { CurrentConversationSession } from './decorators/current-conversation-session.decorator';
import { ConversationV2SessionPermissions } from './constants/conversation-v2-session-permissions';
import type { ConversationV2SessionPermission } from './constants/conversation-v2-session-permissions';
import type { ConversationV2ResolvedSession } from './services/conversation-v2-session-access.service';
import { CreateSessionDto } from './dto/create-session.dto';
import { GetFileSignedUrlDto } from './dto/get-file-signed-url.dto';
import { GetAppSourceUrlsDto } from './dto/get-app-source-urls.dto';
import { PresignRevisionDto } from './dto/presign-revision.dto';
import { CommitWorkspaceRevisionDto } from './dto/commit-workspace-revision.dto';
import { WorkspaceShareService } from '@modules/workspace/workspace-share.service';
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import { WorkspaceService } from '@modules/workspace/workspace.service';
import { ListSessionsDto } from './dto/list-sessions.dto';
import { ListEventsDto } from './dto/list-events.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { DeployAppDto } from './dto/deploy-app.dto';
import { ShareDeployDto } from './dto/share-deploy.dto';
import { DocumentQueryDto } from '@modules/workspace/dto/document-query.dto';
import { VmUnavailableException } from './exceptions/vm-unavailable.exception';
import { ConversationV2EventStoreService, PersistedEventRow } from './services/conversation-v2-event-store.service';
import { ConversationV2DeployService } from './services/conversation-v2-deploy.service';
import { ConversationV2AppShareService } from './services/conversation-v2-app-share.service';
import { normalizeAppSourceCephPrefix } from './utils/normalize-app-source-ceph-prefix';
import { RuntimeTicketService } from '@modules/app-runtime/services/runtime-ticket.service';
import { RuntimeRevisionService } from '@modules/app-runtime/services/runtime-revision.service';
import { RuntimeBindingService } from '@modules/app-runtime/services/runtime-binding.service';
import type { RuntimeTicketResult } from '@modules/app-runtime/types/app-runtime-protocol';

interface AuthUser { id: string; }

interface ConversationV2Request {
  conversationV2Access?: {
    viewerRole: 'owner' | 'shared';
    permissions: ConversationV2SessionPermission[];
  };
}

@ApiTags('conversation-v2')
@ApiBearerAuth()
@Controller('conversation-v2')
export class ConversationV2Controller {
  constructor(
    private readonly grpcClient: ConversationV2GrpcClientService,
    private readonly sessions: ConversationV2SessionService,
    private readonly share: ConversationV2ShareService,
    private readonly workspaceShare: WorkspaceShareService,
    private readonly workspaceDocuments: WorkspaceDocumentService,
    private readonly eventStore: ConversationV2EventStoreService,
    private readonly workspaceService: WorkspaceService,
    private readonly config: ConfigService,
    private readonly deployment: ConversationV2DeployService,
    private readonly appShares: ConversationV2AppShareService,
    private readonly runtimeTickets: RuntimeTicketService,
    private readonly runtimeRevisions: RuntimeRevisionService,
    private readonly runtimeBindings: RuntimeBindingService,
  ) {}

  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  async createSession(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateSessionDto = new CreateSessionDto(),
  ): Promise<{
    sessionId: string;
    workspaceIds: string[];
    systemWorkspaceId: string;
  }> {
    // Empty selection means "use all of my workspaces" — expand here so the
    // draft pointer, the gRPC session's workspace_paths, and the response
    // body all carry the same set. Owner-only by design: the new-conversation
    // picker shows owned workspaces, so the default mirrors that.
    let workspaceIds = body.workspaceIds ?? [];
    if (workspaceIds.length === 0) {
      workspaceIds = await this.workspaceService.findIdsByOwner(user.id);
    } else {
      await this.workspaceShare.assertUserHasAccess(user.id, workspaceIds);
    }

    const draft = await this.sessions.createDraft(user.id, workspaceIds);
    const draftId = draft._id as Types.ObjectId;

    let systemWorkspaceId: string;
    try {
      const allocatedStorage = this.config.get<number>(
        'conversation.systemWorkspaceStorageBytes',
        52428800,
      );
      const ws = await this.workspaceService.createSystemWorkspace(
        user.id,
        draftId.toString(),
        allocatedStorage,
      );
      systemWorkspaceId = ws.id;
    } catch (err) {
      await this.sessions.deleteDraft(draftId).catch(() => undefined);
      throw err;
    }

    let aiSessionId: string;
    try {
      aiSessionId = await this.grpcClient.createSession(user.id, workspaceIds);
    } catch (err) {
      this.workspaceService.deleteSystemWorkspace(systemWorkspaceId).catch(() => undefined);
      this.sessions.deleteDraft(draftId).catch(() => undefined);
      throw err;
    }

    try {
      await this.sessions.attachAiSession(draftId, aiSessionId, systemWorkspaceId);
    } catch (err) {
      this.grpcClient.stopSession(user.id, aiSessionId).catch(() => undefined);
      this.workspaceService.deleteSystemWorkspace(systemWorkspaceId).catch(() => undefined);
      this.sessions.deleteDraft(draftId).catch(() => undefined);
      throw err;
    }

    return {
      sessionId: draftId.toString(),
      workspaceIds,
      systemWorkspaceId,
    };
  }

  @Get('sessions')
  async listSessions(
    @CurrentUser() user: AuthUser,
    @Query() query: ListSessionsDto,
  ) {
    const items = await this.sessions.list(user.id, query);
    const nextCursor = items.length === (query.limit ?? 20)
      ? items[items.length - 1].lastEventAt
      : null;
    return { items, nextCursor };
  }

  /** Owned + shared Marketplace apps for the current user. */
  @Get('apps')
  async listDeployedApps(@CurrentUser() user: AuthUser): Promise<{
    items: {
      sessionId: string;
      title: string;
      deployedUrl: string;
      lastDeployedAt: string | null;
      source: 'owned' | 'shared';
      shareId: string | null;
      canOpenConversation: boolean;
    }[];
  }> {
    const [owned, shared] = await Promise.all([
      this.sessions.listDeployedApps(user.id),
      this.appShares.listSharedWithUser(user.id),
    ]);
    const ownedIds = new Set(owned.map((app) => app.sessionId));
    const items = [...owned, ...shared.filter((app) => !ownedIds.has(app.sessionId))];
    return { items };
  }

  @Delete('apps/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeDeployedApp(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<void> {
    const removedOwn = await this.sessions.removeDeployedApp(user.id, id);
    if (removedOwn) {
      await this.appShares.deleteAllSharesForSession(id);
      return;
    }
    const removedShare = await this.appShares.removeShareForRecipient(user.id, id);
    if (!removedShare) throw new NotFoundException('Deployed app not found');
  }

  @Get('sessions/:id')
  @UseGuards(ConversationV2SessionAccessGuard)
  @RequireConversationSessionPermission(ConversationV2SessionPermissions.SESSION_READ)
  async getSession(
    @Param('id') id: string,
    @Req() req: ConversationV2Request,
  ): Promise<{
    sessionId: string;
    title: string;
    status: string;
    isShared: boolean;
    workspaceIds: string[];
    selectedSkillIds: string[];
    selectedConnectorIds: string[];
    lastEventAt: Date;
    eventCount: number;
    systemWorkspaceId: string | null;
    deployStatus: string;
    deployedUrl: string | null;
    lastDeployedAt: string | null;
    viewerRole: 'owner' | 'shared';
    permissions: ConversationV2SessionPermission[];
  }> {
    const pointer = await this.sessions.getById(id);
    if (!pointer) throw new NotFoundException('Session not found');
    const access = req.conversationV2Access!;
    return {
      sessionId: (pointer._id as Types.ObjectId).toString(),
      title: pointer.title,
      status: pointer.status,
      isShared: pointer.isShared,
      workspaceIds: pointer.workspaceIds ?? [],
      selectedSkillIds: pointer.selectedSkillIds ?? [],
      selectedConnectorIds: pointer.selectedConnectorIds ?? [],
      lastEventAt: pointer.lastEventAt,
      eventCount: (pointer as unknown as { eventCount?: number }).eventCount ?? 0,
      systemWorkspaceId:
        (pointer as unknown as { systemWorkspaceId?: { toString(): string } | string | null })
          .systemWorkspaceId?.toString() ?? null,
      deployStatus: pointer.deployStatus ?? 'idle',
      deployedUrl: pointer.deployedUrl ?? null,
      lastDeployedAt: pointer.lastDeployedAt
        ? new Date(pointer.lastDeployedAt).toISOString()
        : null,
      viewerRole: access.viewerRole,
      permissions: [...access.permissions],
    };
  }

  @Get('sessions/:id/events')
  @UseGuards(ConversationV2SessionAccessGuard)
  @RequireConversationSessionPermission(ConversationV2SessionPermissions.EVENTS_READ)
  async listEvents(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: ListEventsDto,
  ): Promise<{
    items: Array<{
      sessionId: string;
      sequence: number;
      eventId: string;
      type: string;
      emittedAt: number;
      payload: Record<string, unknown>;
      modelId?: string | null;
    }>;
    nextSince: number;
  }> {
    void user;
    const since = query.since ?? 0;
    const limit = query.limit ?? 200;
    const items = await this.eventStore.listSince(id, since, limit);
    const nextSince = items.length > 0 ? items[items.length - 1].sequence : since;
    return { items, nextSince };
  }

  /**
   * Hands the browser a one-shot credential for the `/app-runtime` socket. The
   * MCP token stays server-side: the browser only ever sees this ticket.
   *
   * Keyed on `aiSessionId`, not the pointer `_id`: APImanus binds the runtime
   * with its own session id, and `workspaceId === conversationSessionId`. Using
   * `_id` here would register the browser socket under a workspace no
   * `tool-invoke` ever targets, so every tool call fails with RUNTIME_OFFLINE.
   * The binding is owner-scoped so a collaborator's ticket can't reassign it.
   */
  @Post('sessions/:id/runtime-ticket')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ConversationV2SessionAccessGuard)
  @RequireConversationSessionPermission(ConversationV2SessionPermissions.SESSION_WRITE)
  issueRuntimeTicket(
    @CurrentConversationSession() session: ConversationV2ResolvedSession,
  ): Promise<RuntimeTicketResult> {
    return this.runtimeTickets.issue({
      conversationSessionId: this.requireWorkspaceId(session),
      userId: session.ownerId,
    });
  }

  @Get('sessions/:id/workspace-documents')
  @UseGuards(ConversationV2SessionAccessGuard)
  @RequireConversationSessionPermission(ConversationV2SessionPermissions.WORKSPACE_DOCUMENTS_READ)
  async listWorkspaceDocuments(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: DocumentQueryDto,
  ) {
    void user;
    const pointer = await this.sessions.getById(id);
    if (!pointer) throw new NotFoundException('Session not found');
    const systemWsId = (pointer as unknown as { systemWorkspaceId?: { toString(): string } | string | null })
      .systemWorkspaceId?.toString() ?? null;
    const attachedIds = (pointer.workspaceIds ?? []).filter((wid) => wid !== systemWsId);
    if (attachedIds.length === 0) {
      return {
        documents: [],
        pagination: { page: 1, limit: query.limit ?? 20, total: 0, totalPages: 0 },
      };
    }
    return this.workspaceDocuments.findByMultipleWorkspaces(attachedIds, query);
  }

  @Patch('sessions/:id')
  @UseGuards(ConversationV2OwnerGuard)
  async patchSession(
    @CurrentConversationSession() session: ConversationV2ResolvedSession,
    @Param('id') id: string,
    @Body() body: UpdateSessionDto,
  ): Promise<{ title?: string; isShared?: boolean; shareToken?: string | null }> {
    const { ownerId } = session;
    let result: { title?: string; isShared?: boolean; shareToken?: string | null } = {};

    if (typeof body.title === 'string') {
      const r = await this.sessions.rename(ownerId, id, body.title);
      result.title = r?.title as string | undefined;
    }

    if (typeof body.isShared === 'boolean') {
      if (body.isShared) {
        const { token, hash } = this.share.issue();
        await this.sessions.setShared(ownerId, id, true, hash);
        result.isShared = true;
        result.shareToken = token;
      } else {
        await this.sessions.setShared(ownerId, id, false, null);
        result.isShared = false;
        result.shareToken = null;
      }
    }

    return result;
  }

  @Delete('sessions/:id')
  @UseGuards(ConversationV2OwnerGuard)
  async deleteSession(
    @CurrentConversationSession() session: ConversationV2ResolvedSession,
    @Param('id') id: string,
  ): Promise<{ deleted: true }> {
    const pointer = session.pointer;
    const ownerId = session.ownerId;
    // Known: there's a small race window between deleteAllByWorkspace and
    // deleteSystemWorkspace where a concurrent stream's fire-and-forget
    // createFromAiArtifact can insert a new document row pointing at the
    // workspace we're about to remove. The document row then outlives the
    // workspace (no FK constraints in Mongo). Documents are tiny and a future
    // orphan-sweep cron would handle them; acceptable for the rework.
    if (pointer?.systemWorkspaceId) {
      const wsId = pointer.systemWorkspaceId.toString();
      await this.workspaceDocuments.deleteAllByWorkspace(wsId);
      await this.workspaceService.deleteSystemWorkspace(wsId);
    }
    await this.sessions.softDelete(ownerId, id);
    await this.appShares.deleteAllSharesForSession(id);
    return { deleted: true };
  }

  @Post('sessions/:id/stop')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ConversationV2OwnerGuard)
  async stopSession(
    @CurrentConversationSession() session: ConversationV2ResolvedSession,
  ): Promise<{ success: true }> {
    const pointer = session.pointer;
    if (!pointer.aiSessionId) {
      throw new NotFoundException('Session not found');
    }
    try {
      await this.grpcClient.stopSession(session.ownerId, pointer.aiSessionId);
      return { success: true };
    } catch (err) {
      this.translateGrpcError(err);
    }
  }

  @Post('sessions/:id/pause')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ConversationV2OwnerGuard)
  async pauseSession(
    @CurrentConversationSession() session: ConversationV2ResolvedSession,
  ): Promise<{ success: true }> {
    const pointer = session.pointer;
    if (!pointer.aiSessionId) {
      throw new NotFoundException('Session not found');
    }
    try {
      await this.grpcClient.pauseSession(session.ownerId, pointer.aiSessionId);
      return { success: true };
    } catch (err) {
      this.translateGrpcError(err);
    }
  }

  @Post('sessions/:id/resume')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ConversationV2OwnerGuard)
  async resumeSession(
    @CurrentConversationSession() session: ConversationV2ResolvedSession,
  ): Promise<{ success: true }> {
    const pointer = session.pointer;
    if (!pointer.aiSessionId) {
      throw new NotFoundException('Session not found');
    }
    try {
      await this.grpcClient.resumeSession(session.ownerId, pointer.aiSessionId);
      return { success: true };
    } catch (err) {
      this.translateGrpcError(err);
    }
  }

  @Post('sessions/:id/deploy')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ConversationV2OwnerGuard)
  async deploySession(
    @CurrentConversationSession() session: ConversationV2ResolvedSession,
    @Param('id') id: string,
    @Body() body: DeployAppDto,
  ): Promise<{
    deployStatus: string;
    deployedUrl: string | null;
    lastDeployedAt: string | null;
  }> {
    const pointer = session.pointer;
    const ownerId = session.ownerId;
    if (!pointer.aiSessionId) {
      throw new NotFoundException('Session not found');
    }
    // Mark in-flight first so a reload mid-deploy resumes the loader state.
    await this.sessions.setDeployState(ownerId, id, { deployStatus: 'deploying' });

    let deployedUrl: string;
    try {
      const revisionId = await this.resolveDeployRevisionId(pointer.aiSessionId, body.revisionId);
      if (!revisionId) {
        throw new BadRequestException(
          'No finalized revision is available to deploy. Wait until the app is ready.',
        );
      }
      const result = await this.deployment.deploy(pointer.aiSessionId, revisionId);
      deployedUrl = result.url;
    } catch (err) {
      await this.sessions
        .setDeployState(ownerId, id, { deployStatus: 'error' })
        .catch(() => undefined);
      throw err;
    }

    const lastDeployedAt = new Date();
    const deployedAppTitle = body.title?.trim() || pointer.title || null;
    await this.sessions.setDeployState(ownerId, id, {
      deployStatus: 'deployed',
      deployedUrl,
      deployedAppTitle,
      lastDeployedAt,
    });
    await this.appShares.syncDeployMetadata(id, {
      title: deployedAppTitle || 'Untitled app',
      deployedUrl,
      lastDeployedAt,
    });
    return {
      deployStatus: 'deployed',
      deployedUrl,
      lastDeployedAt: lastDeployedAt.toISOString(),
    };
  }

  @Post('sessions/:id/share-deploy')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ConversationV2OwnerGuard)
  async shareDeploy(
    @CurrentConversationSession() session: ConversationV2ResolvedSession,
    @Param('id') id: string,
    @Body() body: ShareDeployDto,
  ): Promise<{ sent: number; notFound: string[]; skippedSelf: string[] }> {
    const pointer = session.pointer;
    const ownerId = session.ownerId;
    if (pointer.deployStatus !== 'deployed' || !pointer.deployedUrl) {
      throw new BadRequestException('App is not deployed yet');
    }
    const title =
      (pointer as { deployedAppTitle?: string | null }).deployedAppTitle?.trim() ||
      pointer.title?.trim() ||
      'Untitled app';
    const result = await this.appShares.shareByEmails({
      ownerId,
      sessionId: id,
      emails: body.emails,
      title,
      deployedUrl: pointer.deployedUrl,
      lastDeployedAt: pointer.lastDeployedAt ? new Date(pointer.lastDeployedAt) : null,
    });
    return {
      sent: result.shared.length,
      notFound: result.notFound,
      skippedSelf: result.skippedSelf,
    };
  }

  @Get('share/v2/:token')
  @Public()
  async getShared(@Param('token') token: string): Promise<{
    session: {
      sessionId: string;
      title: string;
      status: string;
      isShared: boolean;
      workspaceIds: string[];
      systemWorkspaceId: string | null;
    };
    events: PersistedEventRow[];
  }> {
    const hash = this.share.hashToken(token);
    const pointer = await this.sessions.getByShareToken(hash);
    if (!pointer) throw new NotFoundException('Shared session not found');
    const events = await this.eventStore.listSince(
      (pointer._id as Types.ObjectId).toString(),
      0,
      5000,
    );
    return {
      session: {
        sessionId: (pointer._id as Types.ObjectId).toString(),
        title: pointer.title,
        status: pointer.status,
        isShared: pointer.isShared,
        workspaceIds: pointer.workspaceIds ?? [],
        systemWorkspaceId:
          (pointer as unknown as { systemWorkspaceId?: { toString(): string } | string | null })
            .systemWorkspaceId?.toString() ?? null,
      },
      events,
    };
  }

  /**
   * Exchange a message-attachment `path` for a short-lived presigned read URL.
   * The path is the bare Ceph object key the AI service emits in
   * `FileInfo.path` (e.g., `{userId}/files_generated/output.txt`); bucket is
   * resolved from `STORAGE_S3_BUCKET` env config.
   *
   * Authorization is intentionally loose — only the global JWT guard. Mirrors
   * v1 `/conversations/artifact-url` (`conversation.controller.ts:40-66`).
   */
  @Post('files/signed-url')
  @HttpCode(HttpStatus.OK)
  async getFileSignedUrl(
    @CurrentUser() _user: AuthUser,
    @Body() body: GetFileSignedUrlDto,
  ): Promise<{ url: string }> {
    const url = await this.workspaceDocuments.generateReadUrl(body.path);
    return { url };
  }

  /**
   * List files for an authorized source revision (starter or workspace-owned).
   * Prefer this over legacy `app-source/urls` + client `cephPath`.
   */
  @Get('sessions/:id/revisions/:revisionId/files')
  @UseGuards(ConversationV2SessionAccessGuard)
  @RequireConversationSessionPermission(ConversationV2SessionPermissions.SESSION_READ)
  async getRevisionFiles(
    @CurrentConversationSession() session: ConversationV2ResolvedSession,
    @Param('revisionId') revisionId: string,
  ): Promise<{
    revisionId: string;
    files: Array<{ path: string; sha256: string; size: number }>;
  }> {
    const { revisionId: id, files } = await this.runtimeRevisions.listFiles(
      this.requireWorkspaceId(session),
      revisionId,
    );
    return {
      revisionId: id,
      files: files.map(({ path, sha256, size }) => ({ path, sha256, size })),
    };
  }

  /**
   * Batch-presign blob read URLs for paths listed in an authorized revision.
   * Object keys are resolved from the revision manifest only.
   */
  @Post('sessions/:id/revisions/:revisionId/presign')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ConversationV2SessionAccessGuard)
  @RequireConversationSessionPermission(ConversationV2SessionPermissions.SESSION_READ)
  async presignRevisionFiles(
    @CurrentConversationSession() session: ConversationV2ResolvedSession,
    @Param('revisionId') revisionId: string,
    @Body() body: PresignRevisionDto,
  ): Promise<{ items: Array<{ path: string; url: string }> }> {
    const revision = await this.runtimeRevisions.getAuthorizedRevision(
      this.requireWorkspaceId(session),
      revisionId,
    );
    const resolved = this.runtimeRevisions.resolveObjectKeys(revision, body.paths);
    const items: Array<{ path: string; url: string }> = [];

    for (const file of resolved) {
      const url = await this.workspaceDocuments.generateReadUrl(file.objectKey, {
        allowExtensionless: true,
      });
      items.push({ path: file.path, url });
    }

    return { items };
  }

  /**
   * Persist a workspace revision snapshot to Ceph after a browser runtime mutation.
   * The browser is the only writer; object keys are server-assigned from content hashes.
   */
  @Post('sessions/:id/revisions/commit')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ConversationV2SessionAccessGuard)
  @RequireConversationSessionPermission(ConversationV2SessionPermissions.SESSION_WRITE)
  async commitWorkspaceRevision(
    @CurrentConversationSession() session: ConversationV2ResolvedSession,
    @Body() body: CommitWorkspaceRevisionDto,
  ): Promise<{
    revisionId: string;
    parentRevisionId: string | null;
    manifestObjectKey: string;
    fileCount: number;
  }> {
    const manifest = await this.runtimeRevisions.commitWorkspaceRevision({
      workspaceId: this.requireWorkspaceId(session),
      revisionId: body.revisionId,
      parentRevisionId: body.parentRevisionId ?? null,
      files: body.files,
      toolCallId: body.toolCallId ?? null,
    });
    return {
      revisionId: manifest.revisionId,
      parentRevisionId: manifest.parentRevisionId,
      manifestObjectKey: manifest.manifestObjectKey,
      fileCount: manifest.files.length,
    };
  }

  /**
   * Batch-presign read URLs for generated app sources under a Ceph prefix.
   * Used by the frontend to hydrate Nodepod's virtual filesystem.
   *
   * @deprecated Prefer revision-based `…/revisions/:revisionId/presign`.
   */
  @Post('sessions/:id/app-source/urls')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ConversationV2SessionAccessGuard)
  @RequireConversationSessionPermission(ConversationV2SessionPermissions.SESSION_READ)
  async getAppSourceUrls(
    @Param('id') _id: string,
    @Body() body: GetAppSourceUrlsDto,
  ): Promise<{ items: Array<{ path: string; url: string }> }> {
    // Manus/Sandbox Manager may prefix ceph_path with the bucket name; strip it
    // so signed URLs are `{public}/{bucket}/{userId}/appbuilder/...` not
    // `{public}/{bucket}/{bucket}/{userId}/...`.
    const bucket = this.config.get<string>('storage.s3.bucket') || '';
    const prefix = normalizeAppSourceCephPrefix(body.cephPath, bucket);
    if (!prefix) {
      throw new BadRequestException('Invalid cephPath');
    }
    const items: Array<{ path: string; url: string }> = [];

    for (const relative of body.paths) {
      const normalized = relative.replace(/^\/+/, '').replace(/\\/g, '/');
      if (
        !normalized ||
        normalized.includes('..') ||
        normalized.startsWith('/') ||
        normalized.includes('\0')
      ) {
        throw new BadRequestException(`Invalid source path: ${relative}`);
      }
      const objectKey = `${prefix}/${normalized}`;
      // App trees include extensionless files (Dockerfile, LICENSE, …) under a
      // Ceph prefix that itself has no dots — bypass the workspace "folder" guard.
      const url = await this.workspaceDocuments.generateReadUrl(objectKey, {
        allowExtensionless: true,
      });
      items.push({ path: normalized, url });
    }

    return { items };
  }

  @Get('sessions/:id/vnc/signed-url')
  @UseGuards(ConversationV2OwnerGuard)
  async vncSignedUrl(
    @CurrentConversationSession() session: ConversationV2ResolvedSession,
  ): Promise<{ url: string; expiresAt: number }> {
    const pointer = session.pointer;
    if (!pointer.aiSessionId) {
      throw new NotFoundException('Session not found');
    }
    const r = await this.grpcClient.getVncSignedUrl(session.ownerId, pointer.aiSessionId);
    if (!r) throw new VmUnavailableException();
    return r;
  }

  /**
   * App-runtime workspace id for a session. `workspaceId === conversationSessionId`
   * on the binding, and APImanus binds with its own session id, so the pointer
   * `_id` is never a valid workspace key.
   */
  private requireWorkspaceId(session: ConversationV2ResolvedSession): string {
    const { aiSessionId } = session.pointer;
    if (!aiSessionId) {
      throw new NotFoundException('Session not found');
    }
    return aiSessionId;
  }

  private async resolveDeployRevisionId(
    aiSessionId: string,
    requestedRevisionId?: string,
  ): Promise<string | undefined> {
    const trimmed = requestedRevisionId?.trim();
    if (trimmed) return trimmed;

    const binding = await this.runtimeBindings.findByWorkspaceId(aiSessionId);
    const latest = binding?.latestRevisionId?.trim();
    if (!latest || latest === 'starter_react_vite_v1') {
      return undefined;
    }
    return latest;
  }

  private translateGrpcError(err: unknown): never {
    const code = (err as grpc.ServiceError | undefined)?.code;
    if (code === grpc.status.NOT_FOUND || code === grpc.status.PERMISSION_DENIED) {
      throw new NotFoundException('Session not found');
    }
    if (code === grpc.status.UNIMPLEMENTED) {
      throw new NotImplementedException('Operation not supported by upstream');
    }
    throw err as Error;
  }
}
