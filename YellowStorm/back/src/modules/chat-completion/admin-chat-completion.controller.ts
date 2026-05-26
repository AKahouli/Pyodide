import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { ChatCompletionService } from './chat-completion.service';
import { AuditLogService } from '../authorization/services/audit-log.service';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../user/schemas/user.schema';
import { Permissions } from '../authorization/constants/permissions';
import { ChatRequestDto } from './dto/chat-request.dto';
import { CompletionResult } from './interfaces/chat-completion.interface';

@ApiTags('Admin Chat Completion')
@ApiBearerAuth()
@Controller('admin/chat-completion')
@UseGuards(PermissionsGuard)
export class AdminChatCompletionController {
  constructor(
    private readonly chatCompletionService: ChatCompletionService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Post('chat')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.CHAT_COMPLETION_UPDATE)
  @ApiOperation({ summary: 'Send a chat completion request' })
  @ApiResponse({ status: 200, description: 'Completion result' })
  async chat(
    @Body() dto: ChatRequestDto,
    @CurrentUser() actor: UserDocument,
    @Req() req: Request,
  ): Promise<CompletionResult> {
    const result = await this.chatCompletionService.complete({
      messages: dto.messages,
      modelId: dto.modelId,
      temperature: dto.temperature,
      systemPrompt: dto.systemPrompt,
    });

    this.auditLogService.logSuccess({
      actorId: actor._id.toString(),
      actorEmail: actor.email,
      action: 'chat_completion.chat',
      targetType: 'ChatCompletion',
      metadata: {
        model: result.model,
        totalTokens: result.usage.totalTokens,
        latencyMs: result.latencyMs,
        messageCount: dto.messages.length,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return result;
  }
}
