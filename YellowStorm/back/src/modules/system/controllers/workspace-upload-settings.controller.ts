import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { WorkspaceUploadSettingsService } from '../workspace-upload-settings.service';
import type { WorkspaceUploadSettings } from '../interfaces/workspace-upload-settings.interface';

@ApiTags('Workspace Upload Settings')
@ApiBearerAuth()
@Controller('workspace-settings/uploads')
export class WorkspaceUploadSettingsController {
  constructor(private readonly settingsService: WorkspaceUploadSettingsService) {}

  @Get()
  @ApiOperation({
    summary: 'Get allowed workspace upload extensions (current user)',
    description:
      'Returns the global list of file extensions authorized for upload. ' +
      'Used by upload UIs to populate the file input accept attribute.',
  })
  @ApiResponse({ status: 200, description: 'Upload settings retrieved' })
  async getSettings(): Promise<WorkspaceUploadSettings> {
    return this.settingsService.getSettings();
  }
}
