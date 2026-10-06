import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Public } from '@modules/auth/decorators/public.decorator';
import { InternalServiceGuard } from '@modules/auth/guards/internal-service.guard';
import { SkipResponseWrap } from '@modules/response/decorators/skip-response-wrap.decorator';
import { ExecutePyodideDto } from './dto/execute-pyodide.dto';
import { PyodideActorGuard, pyodideActingUserIdFrom } from './guards/pyodide-actor.guard';
import { PyodideRuntimeDispatcher } from './pyodide-runtime.dispatcher';
import { PyodideErrorCode, PyodideExecutionResult } from './pyodide-runtime.types';

const DEFAULT_TIMEOUT_MS = 30_000;

interface ActorRequest {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Trusted service-to-service surface for mcp-pyodide. The acting user comes
 * from the headers (never the body) and the request stays open until the
 * browser worker finishes, errors, times out or disconnects.
 *
 * Responses skip the global `{ success, data, meta }` wrapper: the MCP reads
 * the execution contract off the raw body.
 */
@Public()
@SkipResponseWrap()
@ApiTags('Pyodide Runtime Internal')
@Controller('internal/pyodide-runtime')
@UseGuards(InternalServiceGuard, PyodideActorGuard)
export class PyodideRuntimeInternalController {
  constructor(
    private readonly dispatcher: PyodideRuntimeDispatcher,
    private readonly config: ConfigService,
  ) {}

  @Post('execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Relay a Python execution to the acting user browser runtime' })
  @ApiHeader({ name: 'X-Internal-Token', required: true })
  @ApiHeader({ name: 'X-YellowStorm-User-Id', required: true })
  execute(@Req() request: ActorRequest, @Body() dto: ExecutePyodideDto): Promise<PyodideExecutionResult> {
    if (!this.config.get<boolean>('pyodideRuntime.enabled', false)) {
      return Promise.resolve(this.offline());
    }
    return this.dispatcher.execute(pyodideActingUserIdFrom(request.headers), {
      code: dto.code,
      input: dto.input ?? null,
      timeoutMs: dto.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
  }

  private offline(): PyodideExecutionResult {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      execution: { runtime: 'pyodide', durationMs: 0, coldStart: false, loadedPackages: [] },
      error: {
        code: PyodideErrorCode.RUNTIME_OFFLINE,
        message: 'The browser Python runtime relay is disabled.',
      },
    };
  }
}
