import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  NotImplementedException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import * as grpc from '@grpc/grpc-js';
import { Public } from '@modules/auth/decorators/public.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { AppBuilderGrpcClientService } from './services/app-builder.grpc-client.service';
import { AppBuilderSessionService } from './services/app-builder-session.service';
import type {
  AppRevisionCatalogFields,
  DeployedAppSummary,
  DraftAppSummary,
  SessionRevisionContext,
} from './services/app-builder-session.service';
import { AppBuilderShareService } from './services/app-builder-share.service';
import { AppBuilderOwnerGuard } from './guards/app-builder-owner.guard';
import { AppBuilderSessionAccessGuard } from './guards/app-builder-session-access.guard';
import { RequireAppBuilderSessionPermission } from './decorators/require-app-builder-session-permission.decorator';
import { CurrentAppBuilderSession } from './decorators/current-app-builder-session.decorator';
import { AppBuilderSessionPermissions } from './constants/app-builder-session-permissions';
import { Permissions } from '@modules/authorization/constants/permissions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import type { AppBuilderSessionPermission } from './constants/app-builder-session-permissions';
import type { AppBuilderResolvedSession } from './services/app-builder-session-access.service';
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
import { AppBuilderEventStoreService, PersistedEventRow } from './services/app-builder-event-store.service';
import { AppBuilderDeployService } from './services/app-builder-deploy.service';
import { AppBuilderAppShareService } from './services/app-builder-app-share.service';
import { AppBuilderAppAiFeaturesService } from './services/app-builder-app-ai-features.service';
import { AppBuilderTemplateService } from './services/app-builder-template.service';
import { normalizeAppSourceCephPrefix } from './utils/normalize-app-source-ceph-prefix';
import { RuntimeTicketService } from '@modules/app-runtime/services/runtime-ticket.service';
import { AiPreviewTicketService } from '@modules/ai-proxy/services/ai-preview-ticket.service';
import type { AiPreviewTicketResult } from '@modules/ai-proxy/services/ai-preview-ticket.service';
import { RuntimeRevisionService } from '@modules/app-runtime/services/runtime-revision.service';
import { RuntimeBindingService } from '@modules/app-runtime/services/runtime-binding.service';
import { RuntimeFinalizedRevisionService } from '@modules/app-runtime/services/runtime-finalized-revision.service';
import type { RuntimeTicketResult } from '@modules/app-runtime/types/app-runtime-protocol';

interface AuthUser { id: string; permissions?: string[]; }

interface AppBuilderRequest {
  appBuilderAccess?: {
    viewerRole: 'owner' | 'shared';
    permissions: AppBuilderSessionPermission[];
  };
}

@ApiTags('app-builder')
@ApiBearerAuth()
// `/app-builder` is canonical; `/conversation-v2` is a deprecated alias kept so existing clients,
// bookmarked URLs and integrations keep working. Remove once legacy traffic has stopped.
@Controller(['app-builder', 'conversation-v2'])

export class AppBuilderController {
  private readonly logger = new Logger(AppBuilderController.name);

  constructor(
    private readonly grpcClient: AppBuilderGrpcClientService,
    private readonly sessions: AppBuilderSessionService,
    private readonly share: AppBuilderShareService,
    private readonly workspaceShare: WorkspaceShareService,
    private readonly workspaceDocuments: WorkspaceDocumentService,
    private readonly eventStore: AppBuilderEventStoreService,
    private readonly workspaceService: WorkspaceService,
    private readonly config: ConfigService,
    private readonly deployment: AppBuilderDeployService,
    private readonly appShares: AppBuilderAppShareService,
    private readonly runtimeTickets: RuntimeTicketService,
    private readonly aiPreviewTickets: AiPreviewTicketService,
    private readonly runtimeRevisions: RuntimeRevisionService,
    private readonly runtimeBindings: RuntimeBindingService,
    private readonly finalizedRevisions: RuntimeFinalizedRevisionService,
    private readonly appAiFeatures: AppBuilderAppAiFeaturesService,
    private readonly templates: AppBuilderTemplateService,
  ) {}

  /**
   * Fire-and-forget rollback of a half-created session: drop the draft pointer
   * (which references the system workspace) before the workspace itself.
   */
  private discardDraft(draftId: string, systemWorkspaceId: string): void {
    void this.sessions
      .deleteDraft(draftId)
      .catch(() => undefined)
      .then(() => this.workspaceService.deleteSystemWorkspace(systemWorkspaceId))
      .catch(() => undefined);
  }

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

    // Optional template seed: the session (and therefore the browser runtime
    // binding) boots on the template's published revision.
    let starterRevisionId: string | undefined;
    if (body.templateId) {
      const isSuperAdmin = user.permissions?.includes(Permissions.SUPER_ADMIN) ?? false;
      const template = await this.templates.requireUsableForUser(body.templateId, isSuperAdmin);
      starterRevisionId = template.revisionId ?? undefined;
    }

    const draft = await this.sessions.createDraft(user.id, workspaceIds, starterRevisionId);
    const draftId = draft.id;

    let systemWorkspaceId: string;
    try {
      const allocatedStorage = this.config.get<number>(
        'conversation.systemWorkspaceStorageBytes',
        52428800,
      );
      const ws = await this.workspaceService.createSystemWorkspace(
        user.id,
        draftId,
        allocatedStorage,
      );
      systemWorkspaceId = ws.id;
    } catch (err) {
      await this.sessions.deleteDraft(draftId).catch(() => undefined);
      throw err;
    }

    let aiSessionId: string;
    try {
      aiSessionId = await this.grpcClient.createSession(
        user.id,
        workspaceIds,
        body.capability ?? 'web_app',
      );
    } catch (err) {
      this.discardDraft(draftId, systemWorkspaceId);
      throw err;
    }

    try {
      await this.sessions.attachAiSession(draftId, aiSessionId, systemWorkspaceId);
    } catch (err) {
      this.grpcClient.stopSession(user.id, aiSessionId).catch(() => undefined);
      this.discardDraft(draftId, systemWorkspaceId);
      throw err;
    }

    return {
      sessionId: draftId,
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

  /** Owned deployed, shared, and draft apps for the current user (App Builder). */
  @Get('apps')
  async listDeployedApps(@CurrentUser() user: AuthUser): Promise<{
    deployed: DeployedAppSummary[];
    shared: DeployedAppSummary[];
    drafts: DraftAppSummary[];
  }> {
    const [deployed, shared, drafts] = await Promise.all([
      this.sessions.listDeployedApps(user.id),
      this.appShares.listSharedWithUser(user.id),
      this.sessions.listDraftApps(user.id),
    ]);
    const ownedIds = new Set(deployed.map((app) => app.sessionId));
    const filteredShared = shared.filter((app) => !ownedIds.has(app.sessionId));
    const catalogApps = [...deployed, ...filteredShared, ...drafts];
    const { revisionBySession, contexts } =
      await this.buildRevisionCatalogBySessionId(catalogApps);
    const aiBySession = await this.appAiFeatures.resolveForCatalog(
      catalogApps.map((app) => {
        const context = contexts.get(app.sessionId);
        const revision = revisionBySession.get(app.sessionId);
        const revisionId =
          revision?.lastDeployedRevisionId
          ?? revision?.latestFinalizedRevisionId
          ?? null;
        return {
          sessionId: app.sessionId,
          workspaceId: context?.aiSessionId ?? null,
          revisionId,
          hasAiFeatures: context?.hasAiFeatures === true || app.hasAiFeatures,
          aiFeaturesCheckedRevisionId: context?.aiFeaturesCheckedRevisionId ?? null,
        };
      }),
    );

    const withCatalog = <T extends { sessionId: string; hasAiFeatures: boolean }>(
      app: T,
      includeDeployedRevision: boolean,
    ): T & AppRevisionCatalogFields => ({
      ...this.applyRevisionCatalog(app, revisionBySession.get(app.sessionId), includeDeployedRevision),
      hasAiFeatures: aiBySession.get(app.sessionId) === true,
    });

    return {
      deployed: deployed.map((app) => withCatalog(app, true)),
      shared: filteredShared.map((app) => withCatalog(app, true)),
      drafts: drafts.map((app) => withCatalog(app, false)),
    };
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
  @UseGuards(AppBuilderSessionAccessGuard)
  @RequireAppBuilderSessionPermission(AppBuilderSessionPermissions.SESSION_READ)
  async getSession(
    @Param('id') id: string,
    @Req() req: AppBuilderRequest,
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
    /** Template `template_<id>` or system starter — needed so refresh keeps the clone preview. */
    starterRevisionId: string | null;
    deployStatus: string;
    deployedUrl: string | null;
    lastDeployedAt: string | null;
    viewerRole: 'owner' | 'shared';
    permissions: AppBuilderSessionPermission[];
  }> {
    const pointer = await this.sessions.getById(id);
    if (!pointer) throw new NotFoundException('Session not found');
    const access = req.appBuilderAccess!;
    return {
      sessionId: pointer.id,
      title: pointer.title,
      status: pointer.status,
      isShared: pointer.isShared,
      workspaceIds: pointer.workspaceIds ?? [],
      selectedSkillIds: pointer.selectedSkillIds ?? [],
      selectedConnectorIds: pointer.selectedConnectorIds ?? [],
      lastEventAt: pointer.lastEventAt,
      eventCount: pointer.eventCount ?? 0,
      systemWorkspaceId: pointer.systemWorkspaceId ?? null,
      starterRevisionId: pointer.starterRevisionId ?? null,
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
  @UseGuards(AppBuilderSessionAccessGuard)
  @RequireAppBuilderSessionPermission(AppBuilderSessionPermissions.EVENTS_READ)
  async listEvents(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: ListEventsDto,
  ): Promise<{
    items: {
      sessionId: string;
      sequence: number;
      eventId: string;
      type: string;
      emittedAt: number;
      payload: Record<string, unknown>;
      modelId?: string | null;
    }[];
    nextSince: number;
  }> {
    user;
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
  @UseGuards(AppBuilderSessionAccessGuard)
  @RequireAppBuilderSessionPermission(AppBuilderSessionPermissions.SESSION_WRITE)
  issueRuntimeTicket(
    @CurrentAppBuilderSession() session: AppBuilderResolvedSession,
  ): Promise<RuntimeTicketResult> {
    return this.runtimeTickets.issue({
      conversationSessionId: this.requireWorkspaceId(session),
      userId: session.ownerId,
    });
  }

  /**
   * Opaque AI preview ticket for BrowserRuntimeHost relay.
   * Never injected into the generated app / iframe — parent holds plaintext only.
   */
  @Post('sessions/:id/ai-preview-ticket')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AppBuilderSessionAccessGuard)
  @RequireAppBuilderSessionPermission(AppBuilderSessionPermissions.SESSION_WRITE)
  issueAiPreviewTicket(
    @CurrentAppBuilderSession() session: AppBuilderResolvedSession,
  ): Promise<AiPreviewTicketResult> {
    return this.aiPreviewTickets.issue({
      conversationSessionId: this.requireWorkspaceId(session),
      billableUserId: session.ownerId,
    });
  }

  @Get('sessions/:id/workspace-documents')
  @UseGuards(AppBuilderSessionAccessGuard)
  @RequireAppBuilderSessionPermission(AppBuilderSessionPermissions.WORKSPACE_DOCUMENTS_READ)
  async listWorkspaceDocuments(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: DocumentQueryDto,
  ) {
    user;
    const pointer = await this.sessions.getById(id);
    if (!pointer) throw new NotFoundException('Session not found');
    const systemWsId = pointer.systemWorkspaceId ?? null;
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
  @UseGuards(AppBuilderOwnerGuard)
  async patchSession(
    @CurrentAppBuilderSession() session: AppBuilderResolvedSession,
    @Param('id') id: string,
    @Body() body: UpdateSessionDto,
  ): Promise<{ title?: string; isShared?: boolean; shareToken?: string | null }> {
    const { ownerId } = session;
    const result: { title?: string; isShared?: boolean; shareToken?: string | null } = {};

    if (typeof body.title === 'string') {
      const r = await this.sessions.rename(ownerId, id, body.title);
      result.title = r?.title;
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
  @UseGuards(AppBuilderOwnerGuard)
  async deleteSession(
    @CurrentAppBuilderSession() session: AppBuilderResolvedSession,
    @Param('id') id: string,
  ): Promise<{ deleted: true }> {
    const pointer = session.pointer;
    const ownerId = session.ownerId;
    // Capture the system workspace id, then drop the session reference first
    // so the workspace is never deleted while something still points at it.
    const wsId = pointer?.systemWorkspaceId ?? null;
    await this.sessions.softDelete(ownerId, id);
    await this.appShares.deleteAllSharesForSession(id);
    if (wsId) {
      await this.workspaceDocuments.deleteAllByWorkspace(wsId);
      await this.workspaceService.deleteSystemWorkspace(wsId);
    }
    return { deleted: true };
  }

  @Post('sessions/:id/stop')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AppBuilderOwnerGuard)
  async stopSession(
    @CurrentAppBuilderSession() session: AppBuilderResolvedSession,
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
  @UseGuards(AppBuilderOwnerGuard)
  async pauseSession(
    @CurrentAppBuilderSession() session: AppBuilderResolvedSession,
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
  @UseGuards(AppBuilderOwnerGuard)
  async resumeSession(
    @CurrentAppBuilderSession() session: AppBuilderResolvedSession,
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

  @Get('sessions/:id/finalized-versions')
  @UseGuards(AppBuilderSessionAccessGuard)
  @RequireAppBuilderSessionPermission(AppBuilderSessionPermissions.SESSION_READ)
  async listFinalizedVersions(
    @CurrentAppBuilderSession() session: AppBuilderResolvedSession,
    @Param('id') sessionPointerId: string,
  ): Promise<{
    items: {
      revisionId: string;
      title: string;
      finalizedAt: string;
      fileCount?: number;
    }[];
    latestRevisionId: string | null;
  }> {
    const workspaceId = this.requireWorkspaceId(session);
    await this.finalizedRevisions.backfillFromEvents(sessionPointerId, workspaceId);
    const items = await this.finalizedRevisions.listByWorkspace(workspaceId);
    return {
      items,
      latestRevisionId: items[0]?.revisionId ?? null,
    };
  }

  @Post('sessions/:id/deploy')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AppBuilderOwnerGuard)
  async deploySession(
    @CurrentAppBuilderSession() session: AppBuilderResolvedSession,
    @Param('id') id: string,
    @Body() body: DeployAppDto,
  ): Promise<{
    deployStatus: string;
    deployedUrl: string | null;
    lastDeployedAt: string | null;
    ownerInviteToken: string | null;
  }> {
    const pointer = session.pointer;
    const ownerId = session.ownerId;
    const startedAt = Date.now();
    this.logger.log(
      `[deploy] HTTP start session=${id} aiSessionId=${pointer.aiSessionId ?? 'none'} ` +
        `requestedRevision=${body.revisionId?.trim() || 'latest'} title=${body.title?.trim() || 'none'}`,
    );
    if (!pointer.aiSessionId) {
      throw new NotFoundException('Session not found');
    }
    // Mark in-flight first so a reload mid-deploy resumes the loader state.
    await this.sessions.setDeployState(ownerId, id, { deployStatus: 'deploying' });

    let deployedUrl: string;
    let revisionId: string;
    try {
      const resolvedRevisionId = await this.resolveDeployRevisionId(
        pointer.aiSessionId,
        id,
        body.revisionId,
      );
      this.logger.log(
        `[deploy] HTTP resolved revision session=${id} revision=${resolvedRevisionId ?? 'none'}`,
      );
      if (!resolvedRevisionId) {
        throw new BadRequestException(
          'No finalized revision is available to deploy. Wait until the app is ready.',
        );
      }
      revisionId = resolvedRevisionId;
      const result = await this.deployment.deploy(pointer.aiSessionId, revisionId, ownerId);
      deployedUrl = result.url;
      this.logger.log(
        `[deploy] HTTP deployer ok session=${id} revision=${revisionId} url=${deployedUrl} ` +
          `elapsedMs=${Date.now() - startedAt}`,
      );
    } catch (err) {
      this.logger.error(
        `[deploy] HTTP failed session=${id} elapsedMs=${Date.now() - startedAt}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
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
      lastDeployedRevisionId: revisionId,
    });
    await this.appShares.syncDeployMetadata(id, {
      title: deployedAppTitle || 'Untitled app',
      deployedUrl,
      lastDeployedAt,
    });

    try {
      await this.appAiFeatures.detectAndPersist(id, pointer.aiSessionId, revisionId);
    } catch (err) {
      this.logger.warn(
        `AI features detect after deploy failed for session ${id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    let ownerInviteToken: string | null = null;
    try {
      ownerInviteToken = await this.appShares.createOwnerInvite({
        ownerId,
        sessionId: id,
        title: deployedAppTitle || 'Untitled app',
        deployedUrl,
      });
    } catch (err) {
      this.logger.warn(`Owner auto-invite failed for session ${id}: ${err}`);
    }

    this.logger.log(
      `[deploy] HTTP complete session=${id} revision=${revisionId} url=${deployedUrl} ` +
        `invite=${Boolean(ownerInviteToken)} elapsedMs=${Date.now() - startedAt}`,
    );

    return {
      deployStatus: 'deployed',
      deployedUrl,
      lastDeployedAt: lastDeployedAt.toISOString(),
      ownerInviteToken,
    };
  }

  @Post('sessions/:id/share-deploy')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AppBuilderOwnerGuard)
  async shareDeploy(
    @CurrentAppBuilderSession() session: AppBuilderResolvedSession,
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
    const events = await this.eventStore.listSince(pointer.id, 0, 5000);
    return {
      session: {
        sessionId: pointer.id,
        title: pointer.title,
        status: pointer.status,
        isShared: pointer.isShared,
        workspaceIds: pointer.workspaceIds ?? [],
        systemWorkspaceId: pointer.systemWorkspaceId ?? null,
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
  @UseGuards(AppBuilderSessionAccessGuard)
  @RequireAppBuilderSessionPermission(AppBuilderSessionPermissions.SESSION_READ)
  async getRevisionFiles(
    @CurrentAppBuilderSession() session: AppBuilderResolvedSession,
    @Param('revisionId') revisionId: string,
  ): Promise<{
    revisionId: string;
    files: { path: string; sha256: string; size: number }[];
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
  @UseGuards(AppBuilderSessionAccessGuard)
  @RequireAppBuilderSessionPermission(AppBuilderSessionPermissions.SESSION_READ)
  async presignRevisionFiles(
    @CurrentAppBuilderSession() session: AppBuilderResolvedSession,
    @Param('revisionId') revisionId: string,
    @Body() body: PresignRevisionDto,
  ): Promise<{ items: { path: string; url: string }[] }> {
    const revision = await this.runtimeRevisions.getAuthorizedRevision(
      this.requireWorkspaceId(session),
      revisionId,
    );
    const resolved = this.runtimeRevisions.resolveObjectKeys(revision, body.paths);
    const items: { path: string; url: string }[] = [];

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
  @UseGuards(AppBuilderSessionAccessGuard)
  @RequireAppBuilderSessionPermission(AppBuilderSessionPermissions.SESSION_WRITE)
  async commitWorkspaceRevision(
    @CurrentAppBuilderSession() session: AppBuilderResolvedSession,
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
      presentPaths: body.presentPaths,
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
  @UseGuards(AppBuilderSessionAccessGuard)
  @RequireAppBuilderSessionPermission(AppBuilderSessionPermissions.SESSION_READ)
  async getAppSourceUrls(
    @Param('id') _id: string,
    @Body() body: GetAppSourceUrlsDto,
  ): Promise<{ items: { path: string; url: string }[] }> {
    // Manus/Sandbox Manager may prefix ceph_path with the bucket name; strip it
    // so signed URLs are `{public}/{bucket}/{userId}/appbuilder/...` not
    // `{public}/{bucket}/{bucket}/{userId}/...`.
    const bucket = this.config.get<string>('storage.s3.bucket') || '';
    const prefix = normalizeAppSourceCephPrefix(body.cephPath, bucket);
    if (!prefix) {
      throw new BadRequestException('Invalid cephPath');
    }
    const items: { path: string; url: string }[] = [];

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
  @UseGuards(AppBuilderOwnerGuard)
  async vncSignedUrl(
    @CurrentAppBuilderSession() session: AppBuilderResolvedSession,
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
  private requireWorkspaceId(session: AppBuilderResolvedSession): string {
    const { aiSessionId } = session.pointer;
    if (!aiSessionId) {
      throw new NotFoundException('Session not found');
    }
    return aiSessionId;
  }

  private async resolveDeployRevisionId(
    aiSessionId: string,
    sessionPointerId: string,
    requestedRevisionId?: string,
  ): Promise<string | undefined> {
    await this.finalizedRevisions.backfillFromEvents(sessionPointerId, aiSessionId);

    const trimmed = requestedRevisionId?.trim();
    if (trimmed) {
      await this.finalizedRevisions.assertFinalized(aiSessionId, trimmed);
      return trimmed;
    }

    return (await this.finalizedRevisions.resolveLatestFinalized(aiSessionId)) ?? undefined;
  }

  private async buildRevisionCatalogBySessionId(
    apps: { sessionId: string }[],
  ): Promise<{
    revisionBySession: Map<string, AppRevisionCatalogFields>;
    contexts: Map<string, SessionRevisionContext>;
  }> {
    const sessionIds = apps.map((app) => app.sessionId);
    const contexts = await this.sessions.resolveRevisionContextBySessionIds(sessionIds);
    const workspaceIds = [
      ...new Set(
        [...contexts.values()]
          .map((ctx) => ctx.aiSessionId)
          .filter((id): id is string => !!id),
      ),
    ];
    const finalizedByWorkspace =
      await this.finalizedRevisions.summarizeByWorkspaces(workspaceIds);

    const revisionBySession = new Map<string, AppRevisionCatalogFields>();
    for (const sessionId of sessionIds) {
      const context = contexts.get(sessionId);
      const workspaceId = context?.aiSessionId;
      const finalized = workspaceId ? finalizedByWorkspace.get(workspaceId) : undefined;
      revisionBySession.set(sessionId, {
        lastDeployedRevisionId: context?.lastDeployedRevisionId ?? null,
        latestFinalizedRevisionId: finalized?.latestRevisionId ?? null,
        latestFinalizedAt: finalized?.latestFinalizedAt ?? null,
        finalizedVersionCount: finalized?.versionCount ?? 0,
      });
    }
    return { revisionBySession, contexts };
  }

  private applyRevisionCatalog<T extends { sessionId: string }>(
    app: T,
    revision: AppRevisionCatalogFields | undefined,
    includeDeployedRevision: boolean,
  ): T & AppRevisionCatalogFields {
    const catalog = revision ?? {
      lastDeployedRevisionId: null,
      latestFinalizedRevisionId: null,
      latestFinalizedAt: null,
      finalizedVersionCount: 0,
    };
    return {
      ...app,
      ...catalog,
      lastDeployedRevisionId: includeDeployedRevision
        ? catalog.lastDeployedRevisionId
        : null,
    };
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
