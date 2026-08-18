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
import { SkipResponseWrap } from '@modules/response/decorators/skip-response-wrap.decorator';
import { RuntimeMcpDispatcherService } from '../services/runtime-mcp-dispatcher.service';

/**
 * YellowMind Runtime MCP — JSON-RPC 2.0 endpoint for OpenCode remote MCP.
 *
 * Target architecture: OpenCode → YellowStorm MCP → Broker → Browser gateway.
 * Authenticated via Bearer MCP token minted on internal bind (never exposed to browser).
 */
@Public()
@SkipResponseWrap()
@ApiTags('App Runtime MCP')
@Controller('mcp/app-runtime')
export class AppRuntimeMcpController {
  constructor(private readonly dispatcher: RuntimeMcpDispatcherService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'YellowMind Runtime MCP JSON-RPC endpoint' })
  async runtimeMcp(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
  ): Promise<Record<string, unknown>> {
    if (!this.dispatcher.isEnabled()) {
      throw new ServiceUnavailableException('Runtime MCP is disabled');
    }
    const response = await this.dispatcher.handleRequest(body, authorization);
    if (Object.keys(response).length === 0) {
      return {};
    }
    return response;
  }
}
