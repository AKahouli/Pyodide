import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { isObjectId } from '@common/postgres/object-id';
import { Public } from '@modules/auth/decorators/public.decorator';
import { InternalServiceGuard } from '@modules/auth/guards/internal-service.guard';
import { SkipResponseWrap } from '@modules/response/decorators/skip-response-wrap.decorator';
import { ExecutePyodideDto } from './dto/execute-pyodide.dto';
import { PyodideActorGuard, pyodideActingUserIdFrom } from './guards/pyodide-actor.guard';
import { PyodideFileError, PyodideFileResolver } from './pyodide-file.resolver';
import { PyodideRuntimeDispatcher } from './pyodide-runtime.dispatcher';
import { PyodideErrorCode, PyodideExecutionResult } from './pyodide-runtime.types';

const DEFAULT_TIMEOUT_MS = 30_000;
const WORKSPACE_HEADER = 'x-yellowstorm-workspace-id';

interface ActorRequest {
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Trusted service-to-service surface for mcp-pyodide. The acting user and the workspace come from the
 * headers (never the body), and the request stays open until the browser worker finishes, errors, times
 * out or disconnects.
 *
 * Responses skip the global `{ success, data, meta }` wrapper: the MCP reads the execution contract off
 * the raw body.
 */
@Public()
@SkipResponseWrap()
@ApiTags('Pyodide Runtime Internal')
@Controller('internal/pyodide-runtime')
@UseGuards(InternalServiceGuard, PyodideActorGuard)
export class PyodideRuntimeInternalController {
  constructor(
    private readonly dispatcher: PyodideRuntimeDispatcher,
    private readonly resolver: PyodideFileResolver,
    private readonly config: ConfigService,
  ) {}

  @Post('execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Relay a Python execution to the acting user browser runtime' })
  @ApiHeader({ name: 'X-Internal-Token', required: true })
  @ApiHeader({ name: 'X-YellowStorm-User-Id', required: true })
  @ApiHeader({ name: 'X-YellowStorm-Workspace-Id', required: false })
  async execute(@Req() request: ActorRequest, @Body() dto: ExecutePyodideDto): Promise<PyodideExecutionResult> {
    if (!this.config.get<boolean>('pyodideRuntime.enabled', false)) {
      return this.offline();
    }
    const userId = pyodideActingUserIdFrom(request.headers);
    const workspaceId = this.workspaceIdFrom(request.headers);
    // The model's explicit inputs win; otherwise fall back to the node's trusted input files (§27).
    const requestedInputs = dto.inputs?.length ? dto.inputs : this.inputFileNamesFrom(request.headers);
    const wantsFiles = Boolean(requestedInputs?.length) || Boolean(dto.outputs?.length);
    if (wantsFiles && !workspaceId) {
      return this.failure('PYODIDE_EXECUTION_ERROR', 'A trusted workspace context is required for file operations.');
    }

    let inputFiles;
    try {
      inputFiles = await this.resolver.resolveInputs(userId, workspaceId ?? '', requestedInputs ?? []);
    } catch (error) {
      if (error instanceof PyodideFileError) return this.failure(error.code, error.message);
      throw error;
    }

    const result = await this.dispatcher.execute(userId, {
      code: dto.code,
      input: dto.input ?? null,
      timeoutMs: dto.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      inputs: requestedInputs,
      outputs: dto.outputs,
      inputFiles,
    });

    if (result.ok && result.outputFiles?.length && workspaceId) {
      try {
        result.artifacts = await this.resolver.persistOutputs(userId, workspaceId, result.outputFiles);
      } catch (error) {
        if (error instanceof PyodideFileError) return this.failure(error.code, error.message);
        throw error;
      }
    }
    delete result.outputFiles;
    return result;
  }

  private workspaceIdFrom(headers: Record<string, string | string[] | undefined>): string | undefined {
    const raw = headers[WORKSPACE_HEADER];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase();
    return value && isObjectId(value) ? value : undefined;
  }

  private inputFileNamesFrom(headers: Record<string, string | string[] | undefined>): string[] | undefined {
    const raw = headers['x-yellowstorm-input-files'];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!value) return undefined;
    const names = value.split(',').map((name) => name.trim()).filter(Boolean);
    return names.length ? names : undefined;
  }

  private failure(code: string, message: string): PyodideExecutionResult {
    return {
      ok: false,
      stdout: '',
      stderr: '',
      execution: { runtime: 'pyodide', durationMs: 0, coldStart: false, loadedPackages: [] },
      error: { code, message },
    };
  }

  private offline(): PyodideExecutionResult {
    return this.failure(
      PyodideErrorCode.RUNTIME_OFFLINE,
      'The browser Python runtime relay is disabled.',
    );
  }
}
