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
  ServiceUnavailableException,
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
import { CreateSessionDto } from './dto/create-session.dto';
import { GetFileSignedUrlDto } from './dto/get-file-signed-url.dto';
import { WorkspaceShareService } from '@modules/workspace/workspace-share.service';
import { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import { WorkspaceService } from '@modules/workspace/workspace.service';
import { ListSessionsDto } from './dto/list-sessions.dto';
import { ListEventsDto } from './dto/list-events.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { ShareDeployDto } from './dto/share-deploy.dto';
import { EmailService } from '@modules/email';
import { DocumentQueryDto } from '@modules/workspace/dto/document-query.dto';
import { VmUnavailableException } from './exceptions/vm-unavailable.exception';
import { ConversationV2EventStoreService, PersistedEventRow } from './services/conversation-v2-event-store.service';
import { ConversationV2DeployService } from './services/conversation-v2-deploy.service';

interface AuthUser { id: string; }

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
    private readonly email: EmailService,
    private readonly deployment: ConversationV2DeployService,
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

  @Get('sessions/:id')
  @UseGuards(ConversationV2OwnerGuard)
  async getSession(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
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
  }> {
    const pointer = await this.sessions.getOne(user.id, id);
    if (!pointer) throw new NotFoundException('Session not found');
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
    };
  }

  @Get('sessions/:id/events')
  @UseGuards(ConversationV2OwnerGuard)
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

  @Get('sessions/:id/workspace-documents')
  @UseGuards(ConversationV2OwnerGuard)
  async listWorkspaceDocuments(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query() query: DocumentQueryDto,
  ) {
    const pointer = await this.sessions.getOne(user.id, id);
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
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateSessionDto,
  ): Promise<{ title?: string; isShared?: boolean; shareToken?: string | null }> {
    let result: { title?: string; isShared?: boolean; shareToken?: string | null } = {};

    if (typeof body.title === 'string') {
      const r = await this.sessions.rename(user.id, id, body.title);
      result.title = r?.title as string | undefined;
    }

    if (typeof body.isShared === 'boolean') {
      if (body.isShared) {
        const { token, hash } = this.share.issue();
        await this.sessions.setShared(user.id, id, true, hash);
        result.isShared = true;
        result.shareToken = token;
      } else {
        await this.sessions.setShared(user.id, id, false, null);
        result.isShared = false;
        result.shareToken = null;
      }
    }

    return result;
  }

  @Delete('sessions/:id')
  @UseGuards(ConversationV2OwnerGuard)
  async deleteSession(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<{ deleted: true }> {
    const pointer = await this.sessions.getOne(user.id, id);
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
    await this.sessions.softDelete(user.id, id);
    return { deleted: true };
  }

  @Post('sessions/:id/stop')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ConversationV2OwnerGuard)
  async stopSession(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<{ success: true }> {
    const pointer = await this.sessions.getOne(user.id, id);
    if (!pointer || !pointer.aiSessionId) {
      throw new NotFoundException('Session not found');
    }
    try {
      await this.grpcClient.stopSession(user.id, pointer.aiSessionId);
      return { success: true };
    } catch (err) {
      this.translateGrpcError(err);
    }
  }

  @Post('sessions/:id/pause')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ConversationV2OwnerGuard)
  async pauseSession(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<{ success: true }> {
    const pointer = await this.sessions.getOne(user.id, id);
    if (!pointer || !pointer.aiSessionId) {
      throw new NotFoundException('Session not found');
    }
    try {
      await this.grpcClient.pauseSession(user.id, pointer.aiSessionId);
      return { success: true };
    } catch (err) {
      this.translateGrpcError(err);
    }
  }

  @Post('sessions/:id/resume')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ConversationV2OwnerGuard)
  async resumeSession(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<{ success: true }> {
    const pointer = await this.sessions.getOne(user.id, id);
    if (!pointer || !pointer.aiSessionId) {
      throw new NotFoundException('Session not found');
    }
    try {
      await this.grpcClient.resumeSession(user.id, pointer.aiSessionId);
      return { success: true };
    } catch (err) {
      this.translateGrpcError(err);
    }
  }

  @Post('sessions/:id/deploy')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ConversationV2OwnerGuard)
  async deploySession(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<{
    deployStatus: string;
    deployedUrl: string | null;
    lastDeployedAt: string | null;
  }> {
    const pointer = await this.sessions.getOne(user.id, id);
    if (!pointer || !pointer.aiSessionId) {
      throw new NotFoundException('Session not found');
    }
    // Mark in-flight first so a reload mid-deploy resumes the loader state.
    await this.sessions.setDeployState(user.id, id, { deployStatus: 'deploying' });

    let deployedUrl: string;
    try {
      const result = await this.deployment.deploy(user.id, pointer.aiSessionId);
      deployedUrl = result.url;
    } catch (err) {
      await this.sessions
        .setDeployState(user.id, id, { deployStatus: 'error' })
        .catch(() => undefined);
      throw err;
    }

    const lastDeployedAt = new Date();
    await this.sessions.setDeployState(user.id, id, {
      deployStatus: 'deployed',
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
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: ShareDeployDto,
  ): Promise<{ sent: number }> {
    const pointer = await this.sessions.getOne(user.id, id);
    if (!pointer) throw new NotFoundException('Session not found');
    const url = pointer.deployedUrl;
    if (!url) {
      throw new BadRequestException('App is not deployed yet');
    }
    if (!this.email.isAvailable()) {
      throw new ServiceUnavailableException('Email service is not available');
    }

    const appName = pointer.title?.trim() || 'an app';
    const subject = `${appName} has been shared with you`;
    const html = `
      <p>Hello,</p>
      <p>An app built on ${this.config.get<string>('app.name', 'YelloStorm')} has been shared with you.</p>
      <p><a href="${url}" target="_blank" rel="noreferrer">${url}</a></p>
      <p>You can open it any time at the link above.</p>
    `;
    const text = `An app has been shared with you.\n\nOpen it here: ${url}\n`;

    // Dedupe and send one email per recipient; tolerate individual failures so
    // one bad address doesn't fail the whole batch.
    const recipients = Array.from(new Set(body.emails.map((e) => e.trim().toLowerCase())));
    const results = await Promise.all(
      recipients.map((to) =>
        this.email
          .send({ to, subject, html, text })
          .then((r) => r.success)
          .catch(() => false),
      ),
    );
    const sent = results.filter(Boolean).length;
    return { sent };
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

  @Get('sessions/:id/vnc/signed-url')
  @UseGuards(ConversationV2OwnerGuard)
  async vncSignedUrl(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<{ url: string; expiresAt: number }> {
    const pointer = await this.sessions.getOne(user.id, id);
    if (!pointer || !pointer.aiSessionId) {
      throw new NotFoundException('Session not found');
    }
    const r = await this.grpcClient.getVncSignedUrl(user.id, pointer.aiSessionId);
    if (!r) throw new VmUnavailableException();
    return r;
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
