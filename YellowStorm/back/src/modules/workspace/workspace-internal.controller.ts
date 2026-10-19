import { Controller, Post, Body, HttpCode, HttpStatus, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { isObjectId } from '@common/postgres';
import { IsArray, IsString } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { assertAccountApproved } from '../user/utils/assert-account-accessible';
import { PgWorkspaceStore } from './stores/postgres/pg-workspace-store';
import { WorkspaceShareService } from './workspace-share.service';

class ResolveNamesDto {
  @IsArray()
  @IsString({ each: true })
  ids!: string[];
}

@ApiTags('Workspace Internal')
@Controller({ path: 'workspaces/internal', version: VERSION_NEUTRAL })
@ApiBearerAuth()
export class WorkspaceInternalController {
  constructor(
    private readonly workspaceStore: PgWorkspaceStore,
    private readonly shares: WorkspaceShareService,
  ) {}

  @Post('resolve-names')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve names of workspaces accessible to the signed-in user' })
  @ApiResponse({ status: 200, description: 'Map of id -> name' })
  @ApiResponse({ status: 401, description: 'User authentication required' })
  @ApiResponse({ status: 403, description: 'Workspace access denied' })
  async resolveNames(
    @Body() dto: ResolveNamesDto,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, string>> {
    assertAccountApproved(user);
    const ids = (dto.ids || []).map((id) => String(id).toLowerCase()).filter((id) => isObjectId(id));
    if (!ids.length) return {};

    await this.shares.assertUserHasAccess(user._id.toString(), ids);
    const byId = await this.workspaceStore.findByIds(ids);

    const result: Record<string, string> = {};
    for (const [id, ws] of byId) {
      result[id] = ws.storagePrefix;
    }
    return result;
  }
}
