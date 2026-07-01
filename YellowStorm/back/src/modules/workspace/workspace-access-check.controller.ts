import {
  Controller,
  Get,
  Query,
  Headers,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  ForbiddenException,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiHeader,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import { Public } from '../auth/decorators/public.decorator';
import { LoggerService } from '../logger';
import { WorkspaceShareService } from './workspace-share.service';
import { CheckWorkspaceAccessDto } from './dto/check-workspace-access.dto';

/**
 * Endpoint for external services (e.g. the indexing API) to check whether a
 * user has any kind of access (owner, shared read, or shared readwrite) to a
 * workspace.
 *
 * Authenticated via the `x-api-key` header validated against INDEXING_API_KEY.
 * Returns 200 when the user has access, 403 when not.
 */
@ApiTags('Workspace Access Check')
@Controller({ path: 'workspaces/internal', version: VERSION_NEUTRAL })
export class WorkspaceAccessCheckController {
  private readonly apiKey: string;

  constructor(
    private readonly shareService: WorkspaceShareService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext('WorkspaceAccessCheckController');
    this.apiKey = this.configService.get<string>('indexing.apiKey', '');
  }

  @Get('check-access')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Check if a user has access to a workspace (external services)',
  })
  @ApiHeader({
    name: 'x-api-key',
    description: 'API key for external service authentication (INDEXING_API_KEY)',
    required: true,
  })
  @ApiResponse({ status: 200, description: 'User has access to the workspace' })
  @ApiResponse({ status: 401, description: 'Invalid API key' })
  @ApiResponse({ status: 403, description: 'User does not have access to the workspace' })
  async checkAccess(
    @Headers('x-api-key') apiKey: string,
    @Query() query: CheckWorkspaceAccessDto,
  ): Promise<{ hasAccess: true }> {
    this.assertApiKey(apiKey);

    const hasAccess = await this.shareService.hasAccess(
      query.userId,
      query.workspaceId,
    );

    if (!hasAccess) {
      throw new ForbiddenException('User does not have access to this workspace');
    }

    return { hasAccess: true };
  }

  private assertApiKey(provided: string | undefined): void {
    if (!this.apiKey) {
      this.logger.warn('Access check called but INDEXING_API_KEY is not configured');
      throw new UnauthorizedException('Invalid API key');
    }

    if (!provided || !this.safeCompare(provided, this.apiKey)) {
      this.logger.warn('Access check called with invalid API key');
      throw new UnauthorizedException('Invalid API key');
    }
  }

  private safeCompare(a: string, b: string): boolean {
    const bufferA = Buffer.from(a);
    const bufferB = Buffer.from(b);
    if (bufferA.length !== bufferB.length) {
      return false;
    }
    return timingSafeEqual(bufferA, bufferB);
  }
}
