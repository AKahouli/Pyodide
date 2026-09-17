import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CheckUsage, UsageLimitGuard } from '../usage';
import { UserDocument } from '../user/schemas/user.schema';
import { AiProxyExceptionFilter } from './ai-proxy-exception.filter';
import { AiProxyService } from './ai-proxy.service';
import { ChatCompletionDto } from './dto/chat-completion.dto';
import { AiProxyRateLimitGuard } from './guards/ai-proxy-rate-limit.guard';

@ApiTags('AI Proxy')
@ApiBearerAuth()
@UseFilters(AiProxyExceptionFilter)
@UseGuards(AiProxyRateLimitGuard)
@Controller({ path: '', version: '1' })
export class AiProxyController {
  constructor(private readonly proxyService: AiProxyService) {}

  @Post('chat/completions')
  @UseGuards(UsageLimitGuard)
  @CheckUsage()
  @HttpCode(HttpStatus.OK)
  async chatCompletions(
    @Req() request: Request,
    @Body() body: ChatCompletionDto,
    @CurrentUser() user: UserDocument,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Record<string, unknown> | void> {
    return this.proxyService.proxyChatCompletion(body, user, request, response);
  }

  @Get('models')
  async listModels(): Promise<{
    object: 'list';
    data: Array<{ id: string; object: 'model'; owned_by: string }>;
  }> {
    return this.proxyService.listModels();
  }
}
