import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@modules/auth/decorators/public.decorator';
import { ConfigService } from '@nestjs/config';
import { AppDataCatalogService } from '../services/app-data-catalog.service';

@ApiTags('App Data Health')
@Controller('app-data/health')
export class AppDataHealthController {
  constructor(
    private readonly config: ConfigService,
    private readonly catalog: AppDataCatalogService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'App Data subsystem health (no business payloads)' })
  health(): {
    enabled: boolean;
    mcp: boolean;
    publicApi: boolean;
    dataTab: boolean;
    remote: boolean;
  } {
    if (!this.config.get<boolean>('appData.enabled', false)) {
      throw new ServiceUnavailableException('App Data disabled');
    }
    return {
      enabled: this.catalog.isEnabled(),
      mcp: this.config.get<boolean>('appData.mcpEnabled', false),
      publicApi: this.config.get<boolean>('appData.publicApiEnabled', false),
      dataTab: this.config.get<boolean>('appData.dataTabEnabled', false),
      // Mirror of the remote controller's marker: this handler only serves
      // when APP_DATA_USE_REMOTE is false, so the field is always false here.
      remote: false,
    };
  }
}
