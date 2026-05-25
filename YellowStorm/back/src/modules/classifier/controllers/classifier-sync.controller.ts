import {
  Controller,
  Get,
  Param,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ClassifierSyncService } from '../services/classifier-sync.service';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserDocument } from '../../user/schemas/user.schema';

@ApiTags('Classifier · Sync')
@ApiBearerAuth()
@Controller('classifier/workspaces/:workspaceId')
export class ClassifierSyncController {
  constructor(private readonly syncService: ClassifierSyncService) {}

  @Get('sync')
  @ApiOperation({ summary: 'Export the workspace as a ZIP archive matching its folder hierarchy' })
  @ApiParam({ name: 'workspaceId', description: 'Workspace ID' })
  async exportZip(
    @CurrentUser() user: UserDocument,
    @Param('workspaceId') workspaceId: string,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.syncService.buildWorkspaceZip(
      user._id.toString(),
      workspaceId,
    );

    const safeAsciiFilename = result.filename.replace(/[^\x20-\x7e]/g, '_');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeAsciiFilename}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
    );
    res.setHeader('Content-Length', result.buffer.length.toString());
    res.setHeader('X-Sync-File-Count', result.fileCount.toString());
    res.setHeader('X-Sync-Unclassified-Count', result.unclassifiedCount.toString());
    res.setHeader('X-Sync-Failed-Count', result.failedCount.toString());

    res.end(result.buffer);
  }
}
