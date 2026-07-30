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
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { UserDocument } from '../user/schemas/user.schema';
import { BadRequestException, UnauthorizedException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { getClientIp } from '@common/utils';
import { RateLimit } from '../rate-limiter';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  private readonly cookieName: string;
  private readonly cookieSecure: boolean;
  private readonly cookieSameSite: 'strict' | 'lax' | 'none';

  constructor(
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly configService: ConfigService,
  ) {
    this.cookieName = this.configService.get<string>('auth.refreshTokenCookieName', 'refresh_token');
    this.cookieSecure = this.configService.get<boolean>('auth.cookieSecure', false);
    this.cookieSameSite = this.configService.get<'strict' | 'lax' | 'none'>('auth.cookieSameSite', 'strict');
  }

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @RateLimit({ limit: 5, windowMs: 60000, keyPrefix: 'auth:register' }) // 5 requests per minute
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User registered successfully' })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  @ApiResponse({ status: 429, description: 'Too many registration attempts' })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 10, windowMs: 60000, keyPrefix: 'auth:login' }) // 10 requests per minute
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  @ApiResponse({ status: 403, description: 'Email not verified or account suspended' })
  @ApiResponse({ status: 429, description: 'Too many login attempts' })
  async login(@Body() dto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] || 'unknown';

    const { loginResponse, refreshToken } = await this.authService.login(
      dto,
      ipAddress,
      userAgent,
    );

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
    const refreshToken = req.cookies?.[this.cookieName];
    await this.authService.logout(refreshToken);

    // Clear refresh token cookie
    this.clearRefreshTokenCookie(res);

    return { message: 'Logged out successfully' };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 30, windowMs: 60000, keyPrefix: 'auth:refresh' }) // 30 requests per minute
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, description: 'Token refreshed successfully' })
  @ApiResponse({ status: 401, description: 'Invalid or expired refresh token' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const refreshToken = req.cookies?.[this.cookieName];
    if (!refreshToken) {
      throw new UnauthorizedException(ErrorCode.AUTH_REFRESH_TOKEN_INVALID, 'Refresh token not provided');
    }

    const ipAddress = getClientIp(req);
    const userAgent = req.headers['user-agent'] || 'unknown';

    const tokens = await this.authService.refreshTokens(refreshToken, ipAddress, userAgent);

    // Set new refresh token in cookie
    this.setRefreshTokenCookie(res, tokens.refreshToken);

    return {
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
    };
  }

  @Public()
  @Get('verify-email')
  @RateLimit({ limit: 5, windowMs: 60000, keyPrefix: 'auth:verify-email' }) // 5 requests per minute
  @ApiOperation({ summary: 'Verify email with token (magic link)' })
  @ApiQuery({ name: 'token', description: 'Email verification token', required: true })
  @ApiResponse({ status: 200, description: 'Email verified successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  async verifyEmail(@Query('token') token: string) {
    if (!token || token.length !== 64) {
      throw new BadRequestException(ErrorCode.INVALID_TOKEN, 'Invalid verification token');
    }
    await this.userService.verifyEmail(token);
    return { message: 'Email verified successfully' };
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 3, windowMs: 300000, keyPrefix: 'auth:resend-verification' }) // 3 requests per 5 minutes
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Resend email verification' })
  @ApiResponse({ status: 200, description: 'Verification email sent' })
  @ApiResponse({ status: 400, description: 'Email already verified' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async resendVerification(@CurrentUser() user: UserDocument) {
    await this.authService.resendVerificationEmail(user._id.toString(), user.email);
    return { message: 'Verification email has been sent' };
  }

  @Public()
  @Post('resend-verification-public')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 3, windowMs: 300000, keyPrefix: 'auth:resend-verification-public' }) // 3 requests per 5 minutes
  @ApiOperation({ summary: 'Resend verification email using previous token (no auth required)' })
  @ApiResponse({ status: 200, description: 'Verification email sent' })
  @ApiResponse({ status: 400, description: 'Invalid token or email already verified' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async resendVerificationPublic(@Body() body: { token: string }) {
    if (!body.token || body.token.length !== 64) {
      throw new BadRequestException(ErrorCode.INVALID_TOKEN, 'Invalid verification token');
    }
    await this.authService.resendVerificationByToken(body.token);
    return { message: 'Verification email has been sent' };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 3, windowMs: 300000, keyPrefix: 'auth:forgot-password' }) // 3 requests per 5 minutes
  @ApiOperation({ summary: 'Request a password reset email' })
  @ApiResponse({ status: 200, description: 'Password reset email sent (if account exists)' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.authService.forgotPassword(dto.email);
    return { message: 'If an account exists with this email, a password reset link has been sent.' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 5, windowMs: 60000, keyPrefix: 'auth:reset-password' }) // 5 requests per minute
  @ApiOperation({ summary: 'Reset password with token' })
  @ApiResponse({ status: 200, description: 'Password reset successfully' })
  @ApiResponse({ status: 400, description: 'Invalid or expired token' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.authService.resetPassword(dto.token, dto.password);
    return { message: 'Password has been reset successfully. Please sign in with your new password.' };
  }

  @Get('sessions')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get active sessions' })
  @ApiResponse({ status: 200, description: 'Sessions retrieved' })
  async getSessions(@CurrentUser() user: UserDocument, @Req() req: Request) {
    const refreshToken = req.cookies?.[this.cookieName];
    const currentSessionId = refreshToken
      ? this.authService.extractSessionIdFromToken(refreshToken)
      : undefined;

    return this.authService.getUserSessions(
      user._id.toString(),
      currentSessionId || undefined,
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
    @CurrentUser() user: UserDocument,
  ) {
    await this.authService.invalidateSession(user._id.toString(), sessionId);
    return { message: 'Session invalidated' };
  }

  /**
   * Set refresh token in HTTP-only cookie
   */
  private setRefreshTokenCookie(res: Response, refreshToken: string): void {
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

    res.cookie(this.cookieName, refreshToken, {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: this.cookieSameSite,
      maxAge,
      path: '/api/v1/auth',
    });
  }

  /**
   * Clear refresh token cookie
   */
  private clearRefreshTokenCookie(res: Response): void {
    res.clearCookie(this.cookieName, {
      httpOnly: true,
      secure: this.cookieSecure,
      sameSite: this.cookieSameSite,
      path: '/api/v1/auth',
    });
  }

}
