import { Controller, Get, Delete, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { UserDocument } from '@modules/user/schemas/user.schema';
import { RateLimit } from '@modules/rate-limiter';
import { ConnectedAppOAuthService } from '../services/connected-app-oauth.service';
import { ConnectedAppTokenService } from '../services/connected-app-token.service';
import { ConnectedAppUserService } from '../services/connected-app-user.service';

@ApiTags('Connected Apps')
@ApiBearerAuth()
@Controller('connected-apps')
export class ConnectedAppController {
  constructor(
    private readonly oauthService: ConnectedAppOAuthService,
    private readonly tokenService: ConnectedAppTokenService,
    private readonly userService: ConnectedAppUserService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List available apps with user connection status' })
  @ApiResponse({ status: 200, description: 'Apps with connection status' })
  async getAvailableApps(@CurrentUser() user: UserDocument) {
    return this.userService.getAvailableApps(user._id.toString());
  }

  @Get('connections')
  @ApiOperation({ summary: 'List user active connections (metadata only)' })
  @ApiResponse({ status: 200, description: 'Active connections' })
  async getUserConnections(@CurrentUser() user: UserDocument) {
    return this.userService.getUserConnections(user._id.toString());
  }

  @Get('mailbox-capability')
  @ApiOperation({ summary: 'Get Microsoft 365 mailbox capability status for the current user' })
  @ApiResponse({ status: 200, description: 'Mailbox capability status' })
  async getMailboxCapability(@CurrentUser() user: UserDocument) {
    return this.tokenService.getMailboxCapability(user._id.toString());
  }

  @Get(':appKey/authorize')
  @RateLimit({ limit: 10, windowMs: 60000, keyPrefix: 'connected-app:authorize' })
  @ApiOperation({ summary: 'Get OAuth authorization URL for a connected app' })
  @ApiParam({ name: 'appKey', description: 'App key (e.g., google-drive, microsoft)' })
  @ApiResponse({ status: 200, description: 'Authorization URL' })
  async authorize(
    @Param('appKey') appKey: string,
    @CurrentUser() user: UserDocument,
  ) {
    const authorizationUrl = await this.oauthService.buildAuthorizationUrl(
      user._id.toString(),
      appKey,
    );
    return { authorizationUrl };
  }

  @Delete(':appKey')
  @ApiOperation({ summary: 'Disconnect from an app' })
  @ApiParam({ name: 'appKey', description: 'App key' })
  @ApiResponse({ status: 200, description: 'Disconnected' })
  @ApiResponse({ status: 404, description: 'Not connected' })
  async disconnect(
    @Param('appKey') appKey: string,
    @CurrentUser() user: UserDocument,
  ) {
    await this.tokenService.disconnect(user._id.toString(), appKey);
    return { message: 'Disconnected successfully' };
  }
}
