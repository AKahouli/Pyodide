import {
  Controller,
  Post,
  Body,
  Get,
  Delete,
  Param,
  Query,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { UserInvitationService } from '../user/user-invitation.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { BadRequestException, UnauthorizedException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { getClientIp } from '@common/utils';
import { AuthThrottleService } from './throttle/auth-throttle.service';
import { LoginLockedException } from './throttle/login-lockout.service';
import { getAuthCookiePath } from './auth-cookie-path';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  private readonly cookieName: string;
  private readonly cookieSecure: boolean;
  private readonly cookieSameSite: 'strict' | 'lax' | 'none';
  private readonly cookiePath: string;

  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly userInvitations: UserInvitationService,
    private readonly configService: ConfigService,
    private readonly throttle: AuthThrottleService,
  ) {
    this.cookieName = this.configService.get<string>('auth.refreshTokenCookieName', 'refresh_token');
    this.cookieSecure = this.configService.get<boolean>('auth.cookieSecure', false);
    this.cookieSameSite = this.configService.get<'strict' | 'lax' | 'none'>('auth.cookieSameSite', 'strict');
    this.cookiePath = getAuthCookiePath(this.configService);
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'Generic result, identical whether or not the email already has an account' })
  @ApiResponse({ status: 400, description: 'Invalid, used, or expired invitation (only when inviteToken is sent)' })
  @ApiResponse({ status: 429, description: 'Too many registration attempts' })
  async register(@Body() dto: RegisterDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.throttle.enforceIp('register', req, res);
    return this.authService.register(dto);
  }

  @Public()
  @Get('invite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve a super-admin invitation token for the landing page' })
  @ApiQuery({ name: 'token', required: true, description: 'Invitation token from the invite link' })
  @ApiResponse({ status: 200, description: 'Invitation is valid: invited email and expiry returned' })
  @ApiResponse({ status: 400, description: 'Invitation is invalid, already used, or expired' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async getInvitation(
    @Query('token') token: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.throttle.enforceIp('inviteLookup', req, res);
    return this.userInvitations.resolve(token ?? '');
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 403, description: 'Email not verified or account suspended' })
  @ApiResponse({ status: 429, description: 'Too many login attempts' })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.throttle.enforceIp('login', req, res);
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] ?? 'unknown';

    const { loginResponse, refreshToken } = await this.authService
      .login(dto, ipAddress, userAgent)
      .catch((error: unknown) => {
        if (error instanceof LoginLockedException) {
          res.setHeader('Retry-After', String(error.retryAfterSeconds));
        }
        throw error;
      });

    // Set refresh token in HTTP-only cookie
    this.setRefreshTokenCookie(res, refreshToken);

    return loginResponse;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout and invalidate current session' })
  @ApiResponse({ status: 200, description: 'Logout successful' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = this.readRefreshTokenCookie(req);
    await this.authService.logout(refreshToken);

    // Clear refresh token cookie
    this.clearRefreshTokenCookie(res);

    return { message: 'Logged out successfully' };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.throttle.enforceIp('refresh', req, res);
    const refreshToken = this.readRefreshTokenCookie(req);
    if (!refreshToken) {
      throw new UnauthorizedException(ErrorCode.AUTH_REFRESH_TOKEN_INVALID, 'Refresh token not provided');
    }

    // Client-generated idempotency identity for one logical rotation. Retries
    // of the same rotation MUST reuse it; it is not an auth credential.
    const rawAttemptId = req.headers['x-refresh-attempt-id'];
    const attemptId = typeof rawAttemptId === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(rawAttemptId)
      ? rawAttemptId
      : undefined;

    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] ?? 'unknown';

    const tokens = await this.authService.refreshTokens(refreshToken, ipAddress, userAgent, attemptId);

    // Set new refresh token in cookie
    this.setRefreshTokenCookie(res, tokens.refreshToken);

    return {
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
    };
  }

  @Public()
  @Get('verify-email')
  @ApiOperation({ summary: 'Verify email with token (magic link)' })
  @ApiQuery({ name: 'token', description: 'Email verification token', required: true })
  @ApiResponse({ status: 200, description: 'Email verified successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async verifyEmail(
    @Query('token') token: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.throttle.enforceIp('verifyEmail', req, res);
    if (token?.length !== 64) {
      throw new BadRequestException(ErrorCode.INVALID_TOKEN, 'Invalid verification token');
    }
    await this.userService.verifyEmail(token);
    return { message: 'Email verified successfully' };
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resend email verification' })
  @ApiResponse({ status: 200, description: 'Verification email sent' })
  @ApiResponse({ status: 400, description: 'Email already verified' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async resendVerification(
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.throttle.enforceIp('resendVerification', req, res);
    await this.throttle.enforceAccount('resendVerification', user.email, res);
    await this.authService.resendVerificationEmail(user._id, user.email);
    return { message: 'Verification email has been sent' };
  }

  @Public()
  @Post('resend-verification-public')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend verification email using previous token (no auth required)' })
  @ApiResponse({ status: 200, description: 'Verification email sent' })
  @ApiResponse({ status: 400, description: 'Invalid token or email already verified' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async resendVerificationPublic(
    @Body() body: { token?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.throttle.enforceIp('resendVerification', req, res);
    if (body.token?.length !== 64) {
      throw new BadRequestException(ErrorCode.INVALID_TOKEN, 'Invalid verification token');
    }
    // The token identifies the account without revealing its email.
    await this.throttle.enforceAccount('resendVerification', body.token, res);
    await this.authService.resendVerificationByToken(body.token);
    return { message: 'Verification email has been sent' };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset email' })
  @ApiResponse({ status: 200, description: 'Password reset email sent (if account exists)' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.throttle.enforceIp('forgotPassword', req, res);
    await this.throttle.enforceAccount('forgotPassword', dto.email, res);
    await this.authService.forgotPassword(dto.email);
    return { message: 'If an account exists with this email, a password reset link has been sent.' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password with token' })
  @ApiResponse({ status: 200, description: 'Password reset successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.throttle.enforceIp('resetPassword', req, res);
    await this.authService.resetPassword(dto.token, dto.password);
    return { message: 'Password has been reset successfully. Please sign in with your new password.' };
  }

  @Get('sessions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get active sessions' })
  @ApiResponse({ status: 200, description: 'Sessions retrieved' })
  async getSessions(@CurrentUser() user: AuthUser, @Req() req: Request) {
    const refreshToken = this.readRefreshTokenCookie(req);
    const currentSessionId = refreshToken
      ? this.authService.extractSessionIdFromToken(refreshToken)
      : undefined;

    return this.authService.getUserSessions(
      user._id,
      currentSessionId ?? undefined,
    );
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Invalidate a specific session' })
  @ApiResponse({ status: 200, description: 'Session invalidated' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  async invalidateSession(
    @Param('sessionId') sessionId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.authService.invalidateSession(user._id, sessionId);
    return { message: 'Session invalidated' };
  }

  /**
   * Set refresh token in HTTP-only cookie
   */
  private setRefreshTokenCookie(res: Response, refreshToken: string): void {
    res.cookie(this.cookieName, refreshToken, {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: this.cookieSameSite,
      maxAge: this.authService.getRefreshTokenExpiryMs(),
      path: this.cookiePath,
    });
  }

  private readRefreshTokenCookie(req: Request): string | undefined {
    return (req.cookies as Record<string, string> | undefined)?.[this.cookieName];
  }

  /**
   * Clear refresh token cookie
   */
  private clearRefreshTokenCookie(res: Response): void {
    res.clearCookie(this.cookieName, {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: this.cookieSameSite,
      path: this.cookiePath,
    });
  }

}
