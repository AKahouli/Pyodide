import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ClassifierFileService } from '../services/classifier-file.service';
import { AssignFileDto } from '../dto/assign-file.dto';
import { ListFilesQueryDto } from '../dto/list-files-query.dto';
import { IClassifierFileResponse } from '../interfaces/classifier.interface';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';

@ApiTags('Classifier · Files')
@ApiBearerAuth()
@Controller('classifier/workspaces/:workspaceId/files')
export class ClassifierFileController {
  constructor(private readonly fileService: ClassifierFileService) {}

  @Get()
  @ApiOperation({
    summary: 'List workspace files with their classifier folder assignment',
  })
  @ApiParam({ name: 'workspaceId', description: 'Workspace ID' })
  list(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Query() query: ListFilesQueryDto,
  ): Promise<IClassifierFileResponse[]> {
    return this.fileService.listFiles(user._id.toString(), workspaceId, query);
  }

  @Put(':documentId/folder')
  @ApiOperation({
    summary: 'Move a file into a classifier folder (or unclassify with folderId=null)',
  })
  @ApiParam({ name: 'workspaceId', description: 'Workspace ID' })
  @ApiParam({ name: 'documentId', description: 'Workspace document ID' })
  assign(
    @CurrentUser() user: AuthUser,
    @Param('workspaceId') workspaceId: string,
    @Param('documentId') documentId: string,
    @Body() dto: AssignFileDto,
  ): Promise<IClassifierFileResponse> {
    return this.fileService.assignToFolder(
      user._id.toString(),
      workspaceId,
      documentId,
      dto,
    );
  }
}
