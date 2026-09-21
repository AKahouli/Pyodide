import { Controller, Get, Inject, Param, Query, Res, Header } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import { Public } from '@modules/auth/decorators/public.decorator';
import { RateLimit } from '@modules/rate-limiter';
import { LoggerService } from '@modules/logger';
import {
  CONNECTED_APP_OAUTH_STATE_STORE,
  type ConnectedAppOauthStateStore,
} from '../../connected-app/persistence/connected-app.store';
import {
  CONNECTOR_ADMIN_OAUTH_STATE_STORE,
  type ConnectorAdminOauthStateStore,
} from '../persistence/connector.store';
import { ConnectedAppOAuthService } from '../../connected-app/services/connected-app-oauth.service';
import { ConnectorAdminAuthService } from '../services/connector-admin-auth.service';

@ApiTags('Unified OAuth Callback')
@Controller('connected-apps')
export class UnifiedOAuthCallbackController {
  constructor(
    @Inject(CONNECTED_APP_OAUTH_STATE_STORE)
    private readonly userOAuthStateStore: ConnectedAppOauthStateStore,
    @Inject(CONNECTOR_ADMIN_OAUTH_STATE_STORE)
    private readonly adminOAuthStateStore: ConnectorAdminOauthStateStore,
    private readonly userOAuthService: ConnectedAppOAuthService,
    private readonly adminOAuthService: ConnectorAdminAuthService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(UnifiedOAuthCallbackController.name);
  }

  @Public()
  @Get(':appKey/callback')
  @RateLimit({ limit: 20, windowMs: 60000, keyPrefix: 'oauth:callback' })
  @Header('Content-Type', 'text/html')
  @ApiOperation({
    summary: 'Handle unified OAuth callback from provider (supports both user and admin connector flows)',
    description: 'This unified callback handler routes OAuth callbacks to either the user-level flow or admin connector flow based on the OAuth state.',
  })
  @ApiParam({ name: 'appKey', description: 'Connected app key' })
  @ApiQuery({ name: 'code', description: 'Authorization code', required: false })
  @ApiQuery({ name: 'state', description: 'OAuth state parameter', required: false })
  @ApiQuery({ name: 'error', description: 'Error from provider', required: false })
  @ApiResponse({ status: 200, description: 'HTML page that posts message to opener' })
  async unifiedCallback(
    @Param('appKey') appKey: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ) {
    if (error) {
      return res.send(this.buildErrorHtml(appKey, error));
    }

    if (!code || !state) {
      return res.send(this.buildErrorHtml(appKey, 'missing_params'));
    }

    try {
      const flowType = await this.determineFlowType(state);

      if (flowType === 'user') {
        await this.userOAuthService.handleCallback(appKey, code, state);
        const html = this.userOAuthService.buildCallbackHtml(appKey, true);
        return res.send(html);
      } else if (flowType === 'admin-connector') {
        const result = await this.adminOAuthService.handleCallback(appKey, code, state);
        const html = this.adminOAuthService.buildCallbackHtml(result.appKey, result.success, result.error);
        return res.send(html);
      } else {
        return res.send(this.buildErrorHtml(appKey, 'invalid_state'));
      }
    } catch (err) {
      const errorMessage = (err as Error).message || 'Unknown error';
      this.logger.error('Unified OAuth callback failed', {
        appKey,
        error: errorMessage,
        stack: (err as Error).stack,
      });
      return res.send(this.buildErrorHtml(appKey, errorMessage));
    }
  }

  // SELECT EXISTS routing (plan 3.3) — no model injection, no state consumption.
  private async determineFlowType(state: string): Promise<'user' | 'admin-connector' | null> {
    if (await this.userOAuthStateStore.exists(state)) {
      return 'user';
    }
    if (await this.adminOAuthStateStore.exists(state)) {
      return 'admin-connector';
    }
    return null;
  }

  private buildErrorHtml(appKey: string, error: string): string {
    return `<!DOCTYPE html>
<html>
<head><title>Authentication Error</title></head>
<body>
<p style="color:red">Authentication failed: ${error}</p>
<script>
  if (window.opener) {
    window.opener.postMessage({
      type: 'oauth-result',
      appKey: '${appKey}',
      success: false,
      error: '${error}'
    }, '*');
  }
  setTimeout(function() { window.close(); }, 2000);
</script>
</body>
</html>`;
  }
}