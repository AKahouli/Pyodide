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
  UseGuards,
  Inject,
  forwardRef,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
  ApiParam,
} from '@nestjs/swagger';
import { WorkspaceService } from './workspace.service';
import { WorkspaceDocumentService } from './workspace-document.service';
import { WorkspaceShareService } from './workspace-share.service';
import { UsageService } from '../usage/usage.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { UserDocument } from '../user/schemas/user.schema';
import { WorkspaceOwnerGuard, WorkspaceAccessGuard } from './guards';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { WorkspaceQueryDto } from './dto/workspace-query.dto';
import { UpdateVisibilityDto } from './dto/update-visibility.dto';

// Default workspace storage allocation in bytes (100MB)
const DEFAULT_WORKSPACE_STORAGE = 100 * 1024 * 1024; //104857600
// Default max workspaces per user
const DEFAULT_MAX_WORKSPACES = 3;

@ApiTags('Workspaces')
@Controller('workspaces')
@ApiBearerAuth()
export class WorkspaceController {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly workspaceDocumentService: WorkspaceDocumentService,
    private readonly workspaceShareService: WorkspaceShareService,
    @Inject(forwardRef(() => UsageService))
    private readonly usageService: UsageService,
  ) {}

  /**
   * Create a new workspace
   */
  @Post()
  @ApiOperation({ summary: 'Create a new workspace' })
  @ApiResponse({ status: 201, description: 'Workspace created successfully' })
  async create(
    @CurrentUser() user: UserDocument,
    @Body() dto: CreateWorkspaceDto,
  ) {
    // Get user's plan limits
    const plan = await this.usageService.ensureUserHasPlan(
      user._id.toString(),
      user.planId,
    );

    // Get workspace storage and max workspaces from plan
    // Default to free tier limits if not specified (for backwards compatibility)
    const allocatedStorage = plan.workspaceStorageBytes ?? DEFAULT_WORKSPACE_STORAGE;
    const maxWorkspaces = plan.maxWorkspaces ?? DEFAULT_MAX_WORKSPACES;

    return this.workspaceService.create(
      user._id.toString(),
      dto,
      allocatedStorage,
      maxWorkspaces,
    );
  }

  /**
   * List user's workspaces
   */
  @Get()
  @ApiOperation({ summary: 'List workspaces for current user' })
  async findAll(
    @CurrentUser() user: UserDocument,
    @Query() query: WorkspaceQueryDto,
  ) {
    return this.workspaceService.findAllByUser(user._id.toString(), query);
  }

  /**
   * List workspaces shared with current user
   */
  @Get('shared-with-me')
  @ApiOperation({ summary: 'List workspaces shared with current user' })
  async getSharedWithMe(
    @CurrentUser() user: UserDocument,
    @Query() query: WorkspaceQueryDto,
  ) {
    return this.workspaceShareService.findSharedWithUser(user._id.toString(), query);
  }

  /**
   * Get or create personal workspace
   */
  @Get('personal')
  @ApiOperation({ summary: 'Get or create personal workspace for current user' })
  async getPersonal(
    @CurrentUser() user: UserDocument,
  ) {
    // Get user's plan for storage allocation
    const plan = await this.usageService.ensureUserHasPlan(
      user._id.toString(),
      user.planId,
    );

    const allocatedStorage = plan.workspaceStorageBytes ?? DEFAULT_WORKSPACE_STORAGE;

    return this.workspaceService.getOrCreatePersonalWorkspace(
      user._id.toString(),
      allocatedStorage,
    );
  }

  /**
   * Get workspace by ID
   */
  @Get(':id')
  @UseGuards(WorkspaceAccessGuard)
  @ApiOperation({ summary: 'Get workspace by ID' })
  @ApiParam({ name: 'id', description: 'Workspace ID' })
  async findOne(@Param('id') id: string) {
    return this.workspaceService.findById(id);
  }

  /**
   * Get workspace by alias
   */
  @Get('alias/:alias')
  @ApiOperation({ summary: 'Get workspace by alias' })
  @ApiParam({ name: 'alias', description: 'Workspace alias' })
  async findByAlias(
    @CurrentUser() user: UserDocument,
    @Param('alias') alias: string,
  ) {
    return this.workspaceService.findByAlias(user._id.toString(), alias);
  }

  /**
   * Update workspace
   */ 
  @Patch(':id')
  @UseGuards(WorkspaceOwnerGuard)
  @ApiOperation({ summary: 'Update workspace' })
  @ApiParam({ name: 'id', description: 'Workspace ID' })
  async update(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    return this.workspaceService.update(id, user._id.toString(), dto);
  }

  /**
   * Toggle workspace public visibility (owner only)
   */
  @Patch(':id/visibility')
  @UseGuards(WorkspaceOwnerGuard)
  @ApiOperation({ summary: 'Set workspace public/private visibility' })
  @ApiParam({ name: 'id', description: 'Workspace ID' })
  async setVisibility(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: UpdateVisibilityDto,
  ) {
    return this.workspaceService.setVisibility(id, user._id.toString(), dto.isPublic);
  }

  /**
   * Delete workspace
   */
  @Delete(':id')
  @UseGuards(WorkspaceOwnerGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete workspace and all its documents' })
  @ApiParam({ name: 'id', description: 'Workspace ID' })
  async delete(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
  ) {
    // First delete all documents in the workspace
    await this.workspaceDocumentService.deleteAllByWorkspace(id);

    // Then delete the workspace itself
    await this.workspaceService.delete(id, user._id.toString());

    return { message: 'Workspace deleted successfully' };
  }
}
