import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { isObjectId } from '@common/postgres';
import { IsArray, IsString } from 'class-validator';
import { InternalServiceGuard } from '../auth/guards/internal-service.guard';
import { Public } from '../auth/decorators/public.decorator';
import { PgWorkspaceStore } from './stores/postgres/pg-workspace-store';

class ResolveNamesDto {
  @IsArray()
  @IsString({ each: true })
  ids!: string[];
}

@ApiTags('Workspace Internal')
@Controller({ path: 'workspaces/internal', version: VERSION_NEUTRAL })
@UseGuards(InternalServiceGuard)
export class WorkspaceInternalController {
  constructor(
    private readonly workspaceStore: PgWorkspaceStore,
  ) {}

  @Public()
  @Post('resolve-names')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve workspace names from ObjectIds (internal)' })
  @ApiResponse({ status: 200, description: 'Map of id -> name' })
  @ApiResponse({ status: 401, description: 'Invalid internal service token' })
  async resolveNames(
    @Body() dto: ResolveNamesDto,
  ): Promise<Record<string, string>> {
    const ids = (dto.ids || []).map((id) => String(id).toLowerCase()).filter((id) => isObjectId(id));
    if (!ids.length) return {};

    const byId = await this.workspaceStore.findByIds(ids);

    const result: Record<string, string> = {};
    for (const [id, ws] of byId) {
      result[id] = ws.storagePrefix;
    }
    return result;
  }
}
