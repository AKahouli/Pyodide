import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Public } from '@modules/auth/decorators/public.decorator';
import { AppDataClientService } from '../../services/app-data-client.service';

@ApiTags('App Data Health')
@Controller('app-data/health')
export class AppDataRemoteHealthController {
  constructor(
    private readonly config: ConfigService,
    private readonly client: AppDataClientService,
  ) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'App Data subsystem health incl. remote service reachability' })
  async health(): Promise<{
    enabled: boolean;
    mcp: boolean;
    publicApi: boolean;
    dataTab: boolean;
    remote: boolean;
    remoteReady: boolean;
  }> {
    if (!this.config.get<boolean>('appData.enabled', false)) {
      throw new ServiceUnavailableException('App Data disabled');
    }
    return {
      enabled: true,
      mcp: this.config.get<boolean>('appData.mcpEnabled', false),
      publicApi: this.config.get<boolean>('appData.publicApiEnabled', false),
      dataTab: this.config.get<boolean>('appData.dataTabEnabled', false),
      remote: true,
      remoteReady: await this.client.ready(),
    };
  }
}
