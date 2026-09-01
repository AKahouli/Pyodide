import { Controller, Get, Param, Query, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Public } from '@modules/auth/decorators/public.decorator';
import { SkipResponseWrap } from '@modules/response/decorators/skip-response-wrap.decorator';
import { RateLimit } from '@modules/rate-limiter';
import { AppDataEndUserAuthService } from '../services/app-data-end-user-auth.service';

@Public()
@SkipResponseWrap()
@ApiTags('App Data Public Invites')
@Controller('app-data/public/:appDataId/invites')
export class AppDataPublicInviteController {
  constructor(
    private readonly config: ConfigService,
    private readonly auth: AppDataEndUserAuthService,
  ) {}

  private assertEnabled(): void {
    if (
      !this.config.get<boolean>('appData.enabled', false) ||
      !this.config.get<boolean>('appData.publicApiEnabled', false) ||
      !this.config.get<boolean>('appData.endUserAuthEnabled', true)
    ) {
      throw new ServiceUnavailableException('App Data public auth is disabled');
    }
  }

  @Get('resolve')
  @RateLimit({ limit: 20, windowMs: 60_000, keyPrefix: 'app-data:invite:resolve' })
  @ApiOperation({ summary: 'Resolve a deployed-app register invite token' })
  async resolve(@Param('appDataId') appDataId: string, @Query('token') token?: string) {
    this.assertEnabled();
    return this.auth.resolveInvite(appDataId, token ?? '');
  }
}
