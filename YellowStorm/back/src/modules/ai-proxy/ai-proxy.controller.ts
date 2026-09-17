import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseFilters,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../user/schemas/user.schema';
import { AiProxyExceptionFilter } from './ai-proxy-exception.filter';
import { AiProxyService } from './ai-proxy.service';
import { ChatCompletionDto } from './dto/chat-completion.dto';

@ApiTags('AI Proxy')
@ApiBearerAuth()
@UseFilters(AiProxyExceptionFilter)
@Controller({ path: '', version: '1' })
export class AiProxyController {
  constructor(private readonly proxyService: AiProxyService) {}

  @Post('chat/completions')
  @HttpCode(HttpStatus.OK)
  async chatCompletions(
    @Body() body: ChatCompletionDto,
    @CurrentUser() user: UserDocument,
  ): Promise<Record<string, unknown>> {
    return this.proxyService.proxyChatCompletion(body, user);
  }

  @Get('models')
  async listModels(): Promise<{
    object: 'list';
    data: Array<{ id: string; object: 'model'; owned_by: string }>;
  }> {
    return this.proxyService.listModels();
  }
}
