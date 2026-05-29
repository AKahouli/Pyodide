import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { IsArray, IsString } from 'class-validator';
import { InternalServiceGuard } from '../auth/guards/internal-service.guard';
import { Public } from '../auth/decorators/public.decorator';
import { Workspace, WorkspaceDocument } from './schemas/workspace.schema';

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
    @InjectModel(Workspace.name)
    private readonly workspaceModel: Model<WorkspaceDocument>,
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

    const workspaces = await this.workspaceModel
      .find({ _id: { $in: ids.map((id) => new Types.ObjectId(id)) } })
      .select('_id name')
      .lean()
      .exec();

    const result: Record<string, string> = {};
    for (const ws of workspaces) {
      result[ws._id.toString()] = ws.name;
    }
    return result;
  }
}
