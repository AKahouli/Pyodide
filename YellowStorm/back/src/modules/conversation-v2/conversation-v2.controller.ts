import {
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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import * as grpc from '@grpc/grpc-js';
import { Public } from '@modules/auth/decorators/public.decorator';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { ConversationV2GrpcClientService } from './services/conversation-v2.grpc-client.service';
import { ConversationV2SessionService } from './services/conversation-v2-session.service';
import { ConversationV2ShareService } from './services/conversation-v2-share.service';
import { ConversationV2OwnerGuard } from './guards/conversation-v2-owner.guard';
import { CreateSessionDto } from './dto/create-session.dto';
import { ListSessionsDto } from './dto/list-sessions.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { SessionWithEvents } from './types/conversation-v2.types';
import { VmUnavailableException } from './exceptions/vm-unavailable.exception';

interface AuthUser { id: string; }

@ApiTags('conversation-v2')
@ApiBearerAuth()
@Controller('conversation-v2')
export class ConversationV2Controller {
  constructor(
    private readonly grpcClient: ConversationV2GrpcClientService,
    private readonly sessions: ConversationV2SessionService,
    private readonly share: ConversationV2ShareService,
  ) {}

  @Post('sessions')
  @HttpCode(HttpStatus.CREATED)
  async createSession(
    @CurrentUser() user: AuthUser,
    @Body() _body: CreateSessionDto = new CreateSessionDto(),
  ): Promise<{ sessionId: string }> {
    const sessionId = await this.grpcClient.createSession(user.id);
    await this.sessions.createForUser(user.id, sessionId);
    return { sessionId };
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
  ): Promise<SessionWithEvents> {
    try {
      return await this.grpcClient.getSession(user.id, id);
    } catch (err) {
      this.translateGrpcError(err);
    }
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
    try {
      await this.grpcClient.stopSession(user.id, id);
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
    try {
      await this.grpcClient.pauseSession(user.id, id);
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
    try {
      await this.grpcClient.resumeSession(user.id, id);
      return { success: true };
    } catch (err) {
      this.translateGrpcError(err);
    }
  }

  @Get('share/v2/:token')
  @Public()
  async getShared(@Param('token') token: string): Promise<SessionWithEvents> {
    const hash = this.share.hashToken(token);
    const pointer = await this.sessions.getByShareToken(hash);
    if (!pointer) throw new NotFoundException('Shared session not found');
    return this.grpcClient.getSession(pointer.ownerId, pointer.sessionId);
  }

  @Get('sessions/:id/vnc/signed-url')
  @UseGuards(ConversationV2OwnerGuard)
  async vncSignedUrl(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<{ url: string; expiresAt: number }> {
    const r = await this.grpcClient.getVncSignedUrl(user.id, id);
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
