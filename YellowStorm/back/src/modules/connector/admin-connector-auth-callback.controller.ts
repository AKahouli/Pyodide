import { Controller, Get, Header, Param, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '@modules/auth/decorators/public.decorator';
import { LoggerService } from '@modules/logger';
import { RateLimit } from '@modules/rate-limiter';
import { ConnectorAdminAuthService } from './services/connector-admin-auth.service';

@ApiTags('Admin Connectors - OAuth Callback')
@Controller('admin/connectors/oauth')
export class AdminConnectorAuthCallbackController {
  constructor(
    private readonly connectorAdminAuthService: ConnectorAdminAuthService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(AdminConnectorAuthCallbackController.name);
  }

  @Public()
  @Get(':appKey/callback')
  @RateLimit({ limit: 20, windowMs: 60000, keyPrefix: 'admin:connector:callback' })
  @Header('Content-Type', 'text/html')
  @ApiOperation({ summary: 'Handle admin connector OAuth callback from provider' })
  @ApiParam({ name: 'appKey', description: 'Connected app key' })
  @ApiQuery({ name: 'code', required: false })
  @ApiQuery({ name: 'state', required: false })
  @ApiQuery({ name: 'error', required: false })
  @ApiResponse({ status: 200, description: 'HTML page that posts message to opener' })
  async callback(
    @Param('appKey') appKey: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    if (error) {
      return res.send(this.connectorAdminAuthService.buildCallbackHtml(appKey, false, error));
    }

    if (!code || !state) {
      return res.send(this.connectorAdminAuthService.buildCallbackHtml(appKey, false, 'missing_params'));
    }

    try {
      await this.connectorAdminAuthService.handleCallback(appKey, code, state);
      return res.send(this.connectorAdminAuthService.buildCallbackHtml(appKey, true));
    } catch (callbackError) {
      return res.send(
        this.connectorAdminAuthService.buildCallbackHtml(
          appKey,
          false,
          (callbackError as Error).message || 'Unknown error',
        ),
      );
    }
  }
}
