import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Inject } from '@nestjs/common';
import { Types } from 'mongoose';
import { IsArray, IsString } from 'class-validator';
import { InternalServiceGuard } from '../auth/guards/internal-service.guard';
import { Public } from '../auth/decorators/public.decorator';
import { WORKSPACE_STORE, type WorkspaceStore } from './stores/workspace-store';

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
    @Inject(WORKSPACE_STORE) private readonly workspaceStore: WorkspaceStore,
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
    const ids = (dto.ids || []).filter((id) => Types.ObjectId.isValid(id));
    if (!ids.length) return {};

    const byId = await this.workspaceStore.findByIds(ids);

    const result: Record<string, string> = {};
    for (const [id, ws] of byId) {
      result[id] = ws.storagePrefix;
    }
    return result;
  }
}
