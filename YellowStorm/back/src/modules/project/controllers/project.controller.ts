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
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { ProjectService } from '../project.service';
import { ProjectShareService } from '../project-share.service';
import { CreateProjectDto } from '../dto/create-project.dto';
import { UpdateProjectDto } from '../dto/update-project.dto';
import { QueryProjectDto } from '../dto/query-project.dto';
import { UpdateVisibilityDto } from '../dto/update-visibility.dto';
import { ShareQueryDto } from '../dto/share-query.dto';
import {
  IProjectResponse,
  IPaginatedSharedProjects,
} from '../interfaces/project.interface';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserDocument } from '../../user/schemas/user.schema';

@ApiTags('Projects')
@ApiBearerAuth()
@Controller('projects')
export class ProjectController {
  constructor(
    private readonly projectService: ProjectService,
    private readonly projectShareService: ProjectShareService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List user projects' })
  async findAll(
    @CurrentUser() user: UserDocument,
    @Query() query: QueryProjectDto,
  ): Promise<IProjectResponse[]> {
    return this.projectService.findAllByUser(user._id.toString(), query);
  }

  @Get('shared-with-me')
  @ApiOperation({ summary: 'List projects shared with the current user' })
  async findSharedWithMe(
    @CurrentUser() user: UserDocument,
    @Query() query: ShareQueryDto,
  ): Promise<IPaginatedSharedProjects> {
    return this.projectShareService.findSharedWithUser(user._id.toString(), query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get project by ID' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  async findById(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
  ): Promise<IProjectResponse> {
    return this.projectService.findById(user._id.toString(), id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a project' })
  @ApiResponse({ status: 201, description: 'Project created' })
  @ApiResponse({ status: 409, description: 'Name already exists' })
  async create(
    @CurrentUser() user: UserDocument,
    @Body() dto: CreateProjectDto,
  ): Promise<IProjectResponse> {
    return this.projectService.create(user._id.toString(), dto);
  }

  @Patch(':id/visibility')
  @ApiOperation({ summary: 'Toggle public visibility of a project' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  async setVisibility(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: UpdateVisibilityDto,
  ): Promise<IProjectResponse> {
    return this.projectService.setVisibility(id, user._id.toString(), dto.isPublic);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a project' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  async update(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
  ): Promise<IProjectResponse> {
    return this.projectService.update(user._id.toString(), id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a project (detaches its conversations)' })
  @ApiParam({ name: 'id', description: 'Project ID' })
  async delete(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
  ): Promise<void> {
    return this.projectService.delete(user._id.toString(), id);
  }
}
