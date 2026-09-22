import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ClassifierFolderService } from '../services/classifier-folder.service';
import { CreateFolderDto } from '../dto/create-folder.dto';
import { UpdateFolderDto } from '../dto/update-folder.dto';
import { MoveFolderDto } from '../dto/move-folder.dto';
import { IClassifierFolderResponse } from '../interfaces/classifier.interface';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';

@ApiTags('Classifier · Folders')
@ApiBearerAuth()
@Controller('classifier')
export class ClassifierFolderController {
  constructor(private readonly folderService: ClassifierFolderService) {}

  @Get('workspaces/:workspaceId/folders')
  @ApiOperation({ summary: 'List all classifier folders for a workspace' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace ID' })
  listByWorkspace(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
  ): Promise<IClassifierFolderResponse[]> {
    return this.folderService.listByWorkspace(user._id.toString(), workspaceId);
  }

  @Post('workspaces/:workspaceId/folders')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a classifier folder in a workspace' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace ID' })
  create(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Body() dto: CreateFolderDto,
  ): Promise<IClassifierFolderResponse> {
    return this.folderService.create(user._id.toString(), workspaceId, dto);
  }

  @Get('folders/:id')
  @ApiOperation({ summary: 'Get a classifier folder by id' })
  @ApiParam({ name: 'id', description: 'Folder ID' })
  findById(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<IClassifierFolderResponse> {
    return this.folderService.findById(user._id.toString(), id);
  }

  @Patch('folders/:id')
  @ApiOperation({ summary: 'Rename or update a classifier folder' })
  @ApiParam({ name: 'id', description: 'Folder ID' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateFolderDto,
  ): Promise<IClassifierFolderResponse> {
    return this.folderService.update(user._id.toString(), id, dto);
  }

  @Post('folders/:id/move')
  @ApiOperation({ summary: 'Move a classifier folder to a new parent' })
  @ApiParam({ name: 'id', description: 'Folder ID' })
  move(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: MoveFolderDto,
  ): Promise<IClassifierFolderResponse> {
    return this.folderService.move(user._id.toString(), id, dto);
  }

  @Delete('folders/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a classifier folder (cascades children, unassigns files)',
  })
  @ApiParam({ name: 'id', description: 'Folder ID' })
  delete(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<void> {
    return this.folderService.delete(user._id.toString(), id);
  }
}
