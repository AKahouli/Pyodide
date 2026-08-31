import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Public } from '@modules/auth/decorators/public.decorator';
import { SkipResponseWrap } from '@modules/response/decorators/skip-response-wrap.decorator';
import { RateLimit } from '@modules/rate-limiter';
import type { Request } from 'express';
import { AppDataEndUserAuthService } from '../services/app-data-end-user-auth.service';
import {
  AppDataEndUserLoginDto,
  AppDataEndUserRegisterDto,
} from '../dto/app-data-end-user-auth.dto';

@Public()
@SkipResponseWrap()
@ApiTags('App Data Public Auth')
@Controller('app-data/public/:appDataId/auth')
export class AppDataPublicAuthController {
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

  @Post('register')
  @RateLimit({ limit: 5, windowMs: 60_000, keyPrefix: 'app-data:auth:register' })
  @ApiOperation({ summary: 'Register an app end-user account' })
  async register(
    @Param('appDataId') appDataId: string,
    @Body() body: AppDataEndUserRegisterDto,
  ) {
    this.assertEnabled();
    return this.auth.register({
      appDataId,
      email: body.email,
      password: body.password,
      displayName: body.displayName,
    });
  }

  @Post('login')
  @RateLimit({ limit: 10, windowMs: 60_000, keyPrefix: 'app-data:auth:login' })
  @ApiOperation({ summary: 'Login as an app end-user' })
  async login(
    @Param('appDataId') appDataId: string,
    @Body() body: AppDataEndUserLoginDto,
  ) {
    this.assertEnabled();
    return this.auth.login({
      appDataId,
      email: body.email,
      password: body.password,
    });
  }

  @Get('me')
  @RateLimit({ limit: 60, windowMs: 60_000, keyPrefix: 'app-data:auth:me' })
  @ApiOperation({ summary: 'Get current app end-user profile' })
  async me(@Param('appDataId') appDataId: string, @Req() req: Request) {
    this.assertEnabled();
    const user = await this.auth.me(appDataId, req.headers.authorization);
    return { user };
  }
}
