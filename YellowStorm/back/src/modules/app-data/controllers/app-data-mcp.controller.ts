import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@modules/auth/decorators/public.decorator';
import { RateLimit } from '@modules/rate-limiter';
import { SkipResponseWrap } from '@modules/response/decorators/skip-response-wrap.decorator';
import { AppDataMcpDispatcherService } from '../services/app-data-mcp-dispatcher.service';

@Public()
@SkipResponseWrap()
@RateLimit({ limit: 60, windowMs: 60_000, keyPrefix: 'app-data-mcp' })
@ApiTags('App Data MCP')
@Controller('mcp/app-data')
export class AppDataMcpController {
  constructor(private readonly dispatcher: AppDataMcpDispatcherService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'YellowMind App Data MCP JSON-RPC endpoint' })
  async appDataMcp(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
  ): Promise<Record<string, unknown>> {
    if (!this.dispatcher.isEnabled()) {
      throw new ServiceUnavailableException('App Data MCP is disabled');
    }
    const response = await this.dispatcher.handleRequest(body, authorization);
    if (Object.keys(response).length === 0) return {};
    return response;
  }
}
