import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { getClientIp } from '@common/utils';
import { Public } from '@modules/auth/decorators/public.decorator';
import { RateLimit } from '@modules/rate-limiter';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { LoggerService } from '@modules/logger';
import { AuthProviderService } from '../services/auth-provider.service';
import { OAuthFlowService } from '../services/oauth-flow.service';

@ApiTags('OAuth Providers')
@Controller('auth/providers')
export class OAuthController {
  private readonly frontendUrl: string;
  private readonly cookieName: string;
  private readonly cookieSecure: boolean;
  private readonly cookieSameSite: 'strict' | 'lax' | 'none';

  constructor(
    private readonly authProviderService: AuthProviderService,
    private readonly oauthFlowService: OAuthFlowService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(OAuthController.name);
    this.frontendUrl = this.configService.get<string>('app.frontendUrl', 'http://localhost:5173');
    this.cookieName = this.configService.get<string>('auth.refreshTokenCookieName', 'refresh_token');
    this.cookieSecure = this.configService.get<boolean>('auth.cookieSecure', false);
    this.cookieSameSite = this.configService.get<'strict' | 'lax' | 'none'>('auth.cookieSameSite', 'strict');
  }

  @Public()
  @Get()
  @ApiOperation({ summary: 'List enabled OAuth providers (public)' })
  @ApiResponse({ status: 200, description: 'Enabled providers' })
  async listEnabled() {
    return this.authProviderService.findEnabled();
  }

  @Public()
  @Get(':providerKey/authorize')
  @RateLimit({ limit: 10, windowMs: 60000, keyPrefix: 'oauth:authorize' })
  @ApiOperation({ summary: 'Redirect to OAuth provider authorization' })
  @ApiParam({ name: 'providerKey', description: 'Provider key (e.g., microsoft, google)' })
  @ApiResponse({ status: 302, description: 'Redirect to OAuth provider' })
  async authorize(
    @Param('providerKey') providerKey: string,
    @Res() res: Response,
  ) {
    try {
      const authUrl = await this.oauthFlowService.buildAuthorizationUrl(providerKey);
      res.redirect(authUrl); return;
    } catch (error) {
      this.logger.error('OAuth authorize failed', {
        providerKey,
        error: (error as Error).message,
        stack: (error as Error).stack,
      });
      const errorCode = (error as { code?: string }).code || 'oauth_failed';
      res.redirect(
        `${this.frontendUrl}/#/oauth-callback?error=${encodeURIComponent(errorCode)}`,
      ); return;
    }
  }

  @Public()
  @Get(':providerKey/callback')
  @ApiOperation({ summary: 'Handle OAuth callback from provider' })
  @ApiParam({ name: 'providerKey', description: 'Provider key' })
  @ApiQuery({ name: 'code', description: 'Authorization code' })
  @ApiQuery({ name: 'state', description: 'OAuth state parameter' })
  @ApiResponse({ status: 302, description: 'Redirect to frontend with result' })
  async callback(
    @Param('providerKey') providerKey: string,
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // Provider returned an error (e.g., user denied consent)
    if (error) {
      res.redirect(
        `${this.frontendUrl}/#/oauth-callback?error=${encodeURIComponent(error)}`,
      ); return;
    }

    if (!code || !state) {
      res.redirect(
        `${this.frontendUrl}/#/oauth-callback?error=missing_params`,
      ); return;
    }

    try {
      const ipAddress = getClientIp(req);
      const userAgent = req.headers['user-agent'] || 'unknown';

      const result = await this.oauthFlowService.handleCallback(
        providerKey,
        code,
        state,
        ipAddress,
        userAgent,
      );

      if (result.type === 'link_required') {
        res.redirect(
          `${this.frontendUrl}/#/oauth-callback?link_required=true&email=${encodeURIComponent(result.maskedEmail || '')}`,
        ); return;
      }

      // Success — redirect with temp token
      res.redirect(
        `${this.frontendUrl}/#/oauth-callback?token=${result.accessToken}`,
      ); return;
    } catch (err) {
      this.logger.error('OAuth callback failed', {
        providerKey,
        error: (err as Error).message,
        stack: (err as Error).stack,
      });
      const errorCode = (err as { code?: string }).code || 'oauth_failed';
      res.redirect(
        `${this.frontendUrl}/#/oauth-callback?error=${encodeURIComponent(errorCode)}`,
      ); return;
    }
  }

  @Public()
  @Post('exchange')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowMs: 60000, keyPrefix: 'oauth:exchange' })
  @ApiOperation({ summary: 'Exchange OAuth temp token for JWT + refresh cookie' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  async exchange(
    @Body('token') token: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!token) {
      throw new BadRequestException(ErrorCode.AUTH_OAUTH_LINK_TOKEN_INVALID, 'Token is required');
    }

    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] || 'unknown';

    const result = await this.oauthFlowService.exchangeTempToken(token, ipAddress, userAgent);

    // Set refresh token in HTTP-only cookie
    const maxAge = 7 * 24 * 60 * 60 * 1000;
    res.cookie(this.cookieName, result.refreshToken, {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: this.cookieSameSite,
      maxAge,
      path: '/api/v1/auth',
    });

    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
    };
  }

  @Public()
  @Get('link/verify')
  @RateLimit({ limit: 5, windowMs: 60000, keyPrefix: 'oauth:link-verify' })
  @ApiOperation({ summary: 'Verify account linking token from email' })
  @ApiQuery({ name: 'token', description: 'Linking verification token' })
  @ApiResponse({ status: 302, description: 'Redirect to frontend' })
  async verifyLink(
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    if (!token) {
      res.redirect(`${this.frontendUrl}/#/oauth-callback?error=missing_token`); return;
    }

    try {
      await this.oauthFlowService.verifyAndLink(token);
      res.redirect(`${this.frontendUrl}/#/oauth-callback?linked=true`); return;
    } catch (err) {
      const errorCode = (err as { errorCode?: string }).errorCode || 'link_failed';
      res.redirect(
        `${this.frontendUrl}/#/oauth-callback?error=${encodeURIComponent(errorCode)}`,
      ); return;
    }
  }

}
