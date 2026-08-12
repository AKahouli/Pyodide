import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@modules/auth/decorators/public.decorator';
import { InternalServiceGuard } from '@modules/auth/guards/internal-service.guard';
import { SkipResponseWrap } from '@modules/response/decorators/skip-response-wrap.decorator';
import { BindAppRuntimeDto } from '../dto/bind-app-runtime.dto';
import { InvokeAppRuntimeToolDto } from '../dto/invoke-app-runtime-tool.dto';
import {
  BindRuntimeResult,
  RuntimeBindingService,
} from '../services/runtime-binding.service';
import { RuntimeToolDispatcherService } from '../services/runtime-tool-dispatcher.service';
import type { ToolInvokeEnvelope } from '../types/app-runtime-protocol';

/**
 * Service-to-service surface for the APImanus OpenCode gateway.
 *
 * Responses skip the global `{ success, data, meta }` wrapper: the gateway
 * reads `bindingId` / `mcpUrl` / `mcpToken` off the raw body.
 */
@Public()
@SkipResponseWrap()
@ApiTags('App Runtime Internal')
@Controller('internal/app-runtime')
@UseGuards(InternalServiceGuard)
export class AppRuntimeInternalController {
  constructor(
    private readonly bindings: RuntimeBindingService,
    private readonly dispatcher: RuntimeToolDispatcherService,
  ) {}

  @Post('bind')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create or reuse the runtime binding for a conversation session' })
  bind(@Body() dto: BindAppRuntimeDto): Promise<BindRuntimeResult> {
    return this.bindings.bind({
      conversationSessionId: dto.conversationSessionId,
      userId: dto.userId,
    });
  }

  /**
   * Always answers HTTP 200. Tool failures travel in the body so the gateway
   * can rebuild an `McpError` from `error.code` without decoding HTTP statuses.
   */
  @Post('tool-invoke')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dispatch a runtime tool to the connected browser runtime' })
  invokeTool(@Body() dto: InvokeAppRuntimeToolDto): Promise<ToolInvokeEnvelope> {
    return this.dispatcher.invoke(dto);
  }
}
