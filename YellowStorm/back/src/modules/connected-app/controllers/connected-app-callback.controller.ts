import { Controller, Get, Param, Query, Res, Header } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '@modules/auth/decorators/public.decorator';
import { RateLimit } from '@modules/rate-limiter';
import { LoggerService } from '@modules/logger';
import { ConnectedAppOAuthService } from '../services/connected-app-oauth.service';

@ApiTags('Connected Apps - OAuth Callback')
@Controller('connected-apps')
export class ConnectedAppCallbackController {
  constructor(
    private readonly oauthService: ConnectedAppOAuthService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(ConnectedAppCallbackController.name);
  }

  @Public()
  @Get(':appKey/callback')
  @RateLimit({ limit: 20, windowMs: 60000, keyPrefix: 'connected-app:callback' })
  @Header('Content-Type', 'text/html')
  @ApiOperation({ summary: 'Handle OAuth callback from provider (popup)' })
  @ApiParam({ name: 'appKey', description: 'App key' })
  @ApiQuery({ name: 'code', description: 'Authorization code', required: false })
  @ApiQuery({ name: 'state', description: 'OAuth state parameter', required: false })
  @ApiQuery({ name: 'error', description: 'Error from provider', required: false })
  @ApiResponse({ status: 200, description: 'HTML page that posts message to opener' })
  async callback(
    @Param('appKey') appKey: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    if (error) {
      const html = this.oauthService.buildCallbackHtml(appKey, false, error);
      return res.send(html);
    }

    if (!code || !state) {
      const html = this.oauthService.buildCallbackHtml(appKey, false, 'missing_params');
      return res.send(html);
    }

    try {
      await this.oauthService.handleCallback(appKey, code, state);
      const html = this.oauthService.buildCallbackHtml(appKey, true);
      return res.send(html);
    } catch (err) {
      const errorMessage = (err as Error).message || 'Unknown error';
      this.logger.error('Connected app OAuth callback failed', {
        appKey,
        error: errorMessage,
        stack: (err as Error).stack,
      });
      const html = this.oauthService.buildCallbackHtml(appKey, false, errorMessage);
      return res.send(html);
    }
  }
}
