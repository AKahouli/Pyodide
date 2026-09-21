import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { WorkspaceSettingService } from './workspace-setting.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { CreateWorkspaceSettingDto } from './dto/create-workspace-setting.dto';
import { UpdateWorkspaceSettingDto } from './dto/update-workspace-setting.dto';
import { WorkspaceSettingQueryDto } from './dto/workspace-setting-query.dto';

@ApiTags('Workspace Settings')
@Controller('workspace-settings')
@ApiBearerAuth()
export class WorkspaceSettingController {
  constructor(
    private readonly workspaceSettingService: WorkspaceSettingService,
  ) {}

  /**
   * Create a new workspace setting
   */
  @Post()
  @ApiOperation({ summary: 'Create a new workspace setting' })
  @ApiResponse({ status: 201, description: 'Setting created successfully' })
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateWorkspaceSettingDto,
  ) {
    return this.workspaceSettingService.create(user._id.toString(), dto);
  }

  /**
   * List user's workspace settings
   */
  @Get()
  @ApiOperation({ summary: 'List workspace settings for current user' })
  async findAll(
    @CurrentUser() user: AuthUser,
    @Query() query: WorkspaceSettingQueryDto,
  ) {
    return this.workspaceSettingService.findAllByUser(user._id.toString(), query);
  }

  /**
   * List public templates
   */
  @Get('templates')
  @ApiOperation({ summary: 'List public workspace setting templates' })
  async findTemplates(@Query() query: WorkspaceSettingQueryDto) {
    return this.workspaceSettingService.findTemplates(query);
  }

  /**
   * Get workspace setting by ID
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get workspace setting by ID' })
  @ApiParam({ name: 'id', description: 'Setting ID' })
  async findOne(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.workspaceSettingService.findById(id, user._id.toString());
  }

  /**
   * Update workspace setting
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Update workspace setting (owner only)' })
  @ApiParam({ name: 'id', description: 'Setting ID' })
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateWorkspaceSettingDto,
  ) {
    return this.workspaceSettingService.update(id, user._id.toString(), dto);
  }

  /**
   * Delete workspace setting
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete workspace setting (owner only)' })
  @ApiParam({ name: 'id', description: 'Setting ID' })
  async delete(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    await this.workspaceSettingService.delete(id, user._id.toString());
    return { message: 'Setting deleted successfully' };
  }
}
