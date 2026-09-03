import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import { OAuthState, OAuthStateDocument } from '../schemas/oauth-state.schema';
import { ProviderLinkToken, ProviderLinkTokenDocument } from '../schemas/provider-link-token.schema';
import { AuthProviderService } from './auth-provider.service';
import { ProviderLinkService } from './provider-link.service';
import { AuthService } from '@modules/auth/auth.service';
import { UserService } from '@modules/user/user.service';
import { UsageService } from '@modules/usage';
import { AuthorizationService } from '@modules/authorization/authorization.service';
import { EmailService } from '@modules/email';
import { LoggerService } from '@modules/logger';
import { WorkspaceInitializerService } from '@modules/workspace/workspace-initializer.service';
import { assertAccountAccessible } from '@modules/user/utils/assert-account-accessible';
import { BadRequestException, UnauthorizedException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { OAuthCallbackResult, OAuthUserInfo } from '../interfaces/auth-provider.interface';

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const TEMP_TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes
const LINK_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

@Injectable()
export class OAuthFlowService {
  private readonly frontendUrl: string;
  private readonly backendUrl: string;
  private readonly appName: string;

  constructor(
    @InjectModel(OAuthState.name)
    private readonly oauthStateModel: Model<OAuthStateDocument>,
    @InjectModel(ProviderLinkToken.name)
    private readonly providerLinkTokenModel: Model<ProviderLinkTokenDocument>,
    private readonly authProviderService: AuthProviderService,
    private readonly providerLinkService: ProviderLinkService,
    private readonly authService: AuthService,
    private readonly userService: UserService,
    private readonly usageService: UsageService,
    private readonly authorizationService: AuthorizationService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    private readonly logger: LoggerService,
    private readonly workspaceInitializer: WorkspaceInitializerService,
  ) {
    this.logger.setContext(OAuthFlowService.name);
    this.frontendUrl = this.configService.get<string>('app.frontendUrl', 'http://localhost:5173');
    this.backendUrl = this.configService.get<string>('app.backendUrl', 'http://localhost:3000');
    this.appName = this.configService.get<string>('app.name', 'YelloStorm');
  }

  /**
   * Build the OAuth authorization URL and redirect the user.
   */
  async buildAuthorizationUrl(providerKey: string): Promise<string> {
    const provider = await this.authProviderService.findByKey(providerKey);

    // Generate state (CSRF protection)
    const state = crypto.randomBytes(32).toString('hex');

    // PKCE setup
    let codeVerifier: string | undefined;
    let codeChallenge: string | undefined;

    if (provider.pkceEnabled) {
      codeVerifier = this.generateCodeVerifier();
      codeChallenge = this.generateCodeChallenge(codeVerifier);
    }

    // Save state to DB with TTL
    await this.oauthStateModel.create({
      state,
      providerKey: provider.providerKey,
      codeVerifier,
      expiresAt: new Date(Date.now() + OAUTH_STATE_TTL_MS),
    });

    // Build authorization URL
    const apiPrefix = this.configService.get<string>('app.apiPrefix', 'api');
    const redirectUri = `${this.backendUrl}/${apiPrefix}/v1/auth/providers/${provider.providerKey}/callback`;

    const params = new URLSearchParams({
      client_id: provider.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: provider.scopes.join(' '),
      state,
    });

    if (codeChallenge) {
      params.set('code_challenge', codeChallenge);
      params.set('code_challenge_method', 'S256');
    }

    // Append tenant ID to URL if present (Microsoft Azure AD uses it in the URL path)
    let authUrl = provider.authorizationUrl;
    if (provider.tenantId) {
      authUrl = authUrl.replace('{tenant}', provider.tenantId);
    }

    return `${authUrl}?${params.toString()}`;
  }

  /**
   * Handle the OAuth callback — exchange code, fetch user info, run decision tree.
   */
  async handleCallback(
    providerKey: string,
    code: string,
    state: string,
    ipAddress: string,
    userAgent: string,
  ): Promise<OAuthCallbackResult> {
    // 1. Validate state (find, check, delete)
    const oauthState = await this.oauthStateModel.findOneAndDelete({ state });
    if (!oauthState) {
      throw new BadRequestException(ErrorCode.AUTH_OAUTH_STATE_INVALID, 'Invalid or expired OAuth state');
    }
    if (oauthState.providerKey !== providerKey) {
      throw new BadRequestException(ErrorCode.AUTH_OAUTH_STATE_INVALID, 'State provider mismatch');
    }
    if (oauthState.expiresAt < new Date()) {
      throw new BadRequestException(ErrorCode.AUTH_OAUTH_STATE_INVALID, 'OAuth state has expired');
    }

    // 2. Load + decrypt provider config
    const provider = await this.authProviderService.findByKey(providerKey);
    const apiPrefix = this.configService.get<string>('app.apiPrefix', 'api');
    const redirectUri = `${this.backendUrl}/${apiPrefix}/v1/auth/providers/${providerKey}/callback`;

    // 3. Exchange code for tokens
    const tokenResponse = await this.exchangeCodeForTokens(
      provider.tokenUrl,
      provider.tenantId,
      code,
      redirectUri,
      provider.clientId,
      provider.clientSecret,
      oauthState.codeVerifier,
    );

    const accessToken = tokenResponse.access_token;
    if (!accessToken) {
      this.logger.error('OAuth token exchange returned no access_token', { providerKey });
      throw new BadRequestException(ErrorCode.AUTH_OAUTH_FAILED, 'OAuth token exchange failed');
    }

    // 4. Fetch user info
    const userInfo = await this.fetchUserInfo(provider.userinfoUrl, accessToken);

    if (!userInfo.email) {
      throw new BadRequestException(
        ErrorCode.AUTH_OAUTH_EMAIL_MISSING,
        'The OAuth provider did not return an email address',
      );
    }

    // 5. Decision tree
    return this.processOAuthUser(providerKey, userInfo, ipAddress, userAgent);
  }

  /**
   * Exchange a temp token (stored after callback) for real JWT + refresh cookie data.
   */
  async exchangeTempToken(
    tempToken: string,
    ipAddress: string,
    userAgent: string,
  ): Promise<{ accessToken: string; expiresIn: number; refreshToken: string; user: Record<string, unknown> }> {
    const linkToken = await this.providerLinkTokenModel.findOneAndDelete({
      token: tempToken,
      providerKey: '__temp_login__',
    });

    if (!linkToken) {
      throw new UnauthorizedException(ErrorCode.AUTH_OAUTH_LINK_TOKEN_INVALID, 'Invalid or expired temp token');
    }

    if (linkToken.expiresAt < new Date()) {
      throw new UnauthorizedException(ErrorCode.AUTH_OAUTH_LINK_TOKEN_EXPIRED, 'Temp token has expired');
    }

    const user = await this.userService.findById(linkToken.userId.toString());
    if (!user) {
      throw new UnauthorizedException(ErrorCode.USER_NOT_FOUND, 'User not found');
    }

    assertAccountAccessible(user);

    // Generate real tokens
    const userRoles = user.roles || [];
    const [permissions, roleNames] = await Promise.all([
      this.authorizationService.getUserPermissions(userRoles),
      this.authorizationService.getUserRoleNames(userRoles),
    ]);

    const tokens = await this.authService.generateTokens(user, ipAddress, userAgent, permissions, roleNames);

    await this.userService.updateLastLogin(user._id.toString());

    return {
      accessToken: tokens.accessToken,
      expiresIn: tokens.expiresIn,
      refreshToken: tokens.refreshToken,
      user: this.buildUserResponse(user, permissions, roleNames),
    };
  }

  /**
   * Verify a link token from email and link the provider account.
   */
  async verifyAndLink(token: string): Promise<{ userId: string; providerKey: string }> {
    const linkToken = await this.providerLinkTokenModel.findOneAndDelete({ token });

    if (!linkToken) {
      throw new BadRequestException(ErrorCode.AUTH_OAUTH_LINK_TOKEN_INVALID, 'Invalid linking token');
    }

    if (linkToken.expiresAt < new Date()) {
      throw new BadRequestException(ErrorCode.AUTH_OAUTH_LINK_TOKEN_EXPIRED, 'Linking token has expired');
    }

    // Don't process temp login tokens here
    if (linkToken.providerKey === '__temp_login__') {
      throw new BadRequestException(ErrorCode.AUTH_OAUTH_LINK_TOKEN_INVALID, 'Invalid linking token');
    }

    await this.providerLinkService.createLink(
      linkToken.userId,
      linkToken.providerKey,
      linkToken.providerUserId,
      linkToken.providerEmail,
    );

    this.logger.log('Provider linked via email verification', {
      userId: linkToken.userId,
      providerKey: linkToken.providerKey,
    });

    return {
      userId: linkToken.userId.toString(),
      providerKey: linkToken.providerKey,
    };
  }

  // ==================== Private ====================

  /**
   * OAuth decision tree — core logic for linking/creating users.
   */
  private async processOAuthUser(
    providerKey: string,
    userInfo: OAuthUserInfo,
    ipAddress: string,
    userAgent: string,
  ): Promise<OAuthCallbackResult> {
    const email = userInfo.email.toLowerCase();

    // Check existing provider link
    const existingLink = await this.providerLinkService.findByProviderUser(providerKey, userInfo.sub);

    if (existingLink) {
      // Provider already linked — log the user in
      const user = await this.userService.findById(existingLink.userId.toString());
      if (!user) {
        throw new UnauthorizedException(ErrorCode.USER_NOT_FOUND, 'Linked user not found');
      }

      assertAccountAccessible(user);

      // Create temp token for frontend exchange
      const tempToken = await this.createTempLoginToken(user._id);

      return {
        type: 'login',
        accessToken: tempToken,
      };
    }

    // No existing link — check if user exists by email
    const existingUser = await this.userService.findByEmail(email);

    if (existingUser) {
      // User exists but not linked — require email verification to link
      const linkToken = crypto.randomBytes(32).toString('hex');

      await this.providerLinkTokenModel.create({
        token: linkToken,
        userId: existingUser._id,
        providerKey,
        providerUserId: userInfo.sub,
        providerEmail: email,
        expiresAt: new Date(Date.now() + LINK_TOKEN_TTL_MS),
      });

      // Send linking verification email
      this.sendLinkVerificationEmail(existingUser.email, linkToken, providerKey).catch((err) => {
        this.logger.error('Failed to send link verification email', { error: err.message });
      });

      const maskedEmail = this.maskEmail(email);

      return {
        type: 'link_required',
        maskedEmail,
      };
    }

    // No user exists — create new OAuth user
    const newUser = await this.userService.createOAuthUser({
      email,
      profile: {
        firstName: userInfo.given_name,
        lastName: userInfo.family_name,
      },
    });

    // Assign default plan and create personal workspace
    let defaultPlan;
    try {
      defaultPlan = await this.usageService.getDefaultPlan();
      await this.userService.assignPlan(
        newUser._id.toString(),
        defaultPlan._id as Types.ObjectId,
        defaultPlan.slug,
      );
    } catch (error) {
      this.logger.warn('Failed to assign default plan to OAuth user', {
        userId: newUser._id,
        error: (error as Error).message,
      });
    }

    // Create personal workspace for the new OAuth user
    try {
      const workspaceStorage = defaultPlan?.workspaceStorageBytes ?? 100 * 1024 * 1024; // 100MB default
      await this.workspaceInitializer.getOrCreatePersonalWorkspace(
        newUser._id.toString(),
        workspaceStorage,
      );
      this.logger.log('Personal workspace created for new OAuth user', {
        userId: newUser._id,
      });
    } catch (error) {
      this.logger.warn('Failed to create personal workspace for OAuth user', {
        userId: newUser._id,
        error: (error as Error).message,
      });
    }

    // Assign default role
    try {
      const defaultRole = await this.authorizationService.findRoleByName('user');
      if (defaultRole) {
        await this.authorizationService.assignRoleToUser(newUser._id.toString(), defaultRole.id);
      }
    } catch (error) {
      this.logger.warn('Failed to assign default role to OAuth user', {
        userId: newUser._id,
        error: (error as Error).message,
      });
    }

    // Create provider link
    await this.providerLinkService.createLink(
      newUser._id,
      providerKey,
      userInfo.sub,
      email,
    );

    // Create temp token for frontend exchange
    const tempToken = await this.createTempLoginToken(newUser._id);

    this.logger.log('New OAuth user created', {
      userId: newUser._id,
      providerKey,
      email,
    });

    return {
      type: 'login',
      accessToken: tempToken,
    };
  }

  /**
   * Create a short-lived temp token for frontend exchange.
   */
  private async createTempLoginToken(userId: Types.ObjectId): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');

    await this.providerLinkTokenModel.create({
      token,
      userId,
      providerKey: '__temp_login__',
      providerUserId: '__temp__',
      providerEmail: '__temp__',
      expiresAt: new Date(Date.now() + TEMP_TOKEN_TTL_MS),
    });

    return token;
  }

  /**
   * Exchange authorization code for tokens at the provider's token endpoint.
   */
  private async exchangeCodeForTokens(
    tokenUrl: string,
    tenantId: string | undefined,
    code: string,
    redirectUri: string,
    clientId: string,
    clientSecret: string,
    codeVerifier?: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    let url = tokenUrl;
    if (tenantId) {
      url = url.replace('{tenant}', tenantId);
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    });

    if (codeVerifier) {
      body.set('code_verifier', codeVerifier);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error('OAuth token exchange failed', {
        status: response.status,
        body: errorBody,
      });
      throw new BadRequestException(ErrorCode.AUTH_OAUTH_FAILED, 'OAuth token exchange failed');
    }

    return response.json();
  }

  /**
   * Fetch user info from the provider's userinfo endpoint.
   */
  private async fetchUserInfo(userinfoUrl: string, accessToken: string): Promise<OAuthUserInfo> {
    const response = await fetch(userinfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      this.logger.error('OAuth userinfo fetch failed', {
        status: response.status,
        body: errorBody,
      });
      throw new BadRequestException(ErrorCode.AUTH_OAUTH_FAILED, 'Failed to fetch user info from OAuth provider');
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = await response.json();

    return {
      sub: data.sub || data.id || data.oid,
      email: data.email || data.mail || data.userPrincipalName,
      name: data.name || data.displayName,
      given_name: data.given_name || data.givenName,
      family_name: data.family_name || data.surname,
      email_verified: data.email_verified,
    };
  }

  /**
   * Generate PKCE code_verifier (43-128 chars, URL-safe).
   */
  private generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  /**
   * Generate PKCE code_challenge from code_verifier using S256.
   */
  private generateCodeChallenge(codeVerifier: string): string {
    return crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  }

  /**
   * Mask email for display (e.g., j***@example.com).
   */
  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (local.length <= 2) {
      return `${local[0]}***@${domain}`;
    }
    return `${local[0]}***${local[local.length - 1]}@${domain}`;
  }

  /**
   * Build user response object for login.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private buildUserResponse(user: any, permissions: string[], roleNames: string[]): Record<string, unknown> {
    return {
      id: user._id.toString(),
      email: user.email,
      emailVerified: user.emailVerified,
      profileComplete: user.profileComplete,
      profile: {
        firstName: user.profile?.firstName,
        lastName: user.profile?.lastName,
        company: user.profile?.company,
      },
      consents: {
        privacyPolicy: user.consents?.privacyPolicy,
        privacyPolicyAcceptedAt: user.consents?.privacyPolicyAcceptedAt,
        dataSharing: user.consents?.dataSharing,
        dataSharingAcceptedAt: user.consents?.dataSharingAcceptedAt,
      },
      plan: user.planId
        ? {
            id: user.planId.toString(),
            slug: user.planSlug,
            startedAt: user.planStartedAt,
          }
        : undefined,
      status: user.status,
      registrationApproval: user.registrationApproval,
      permissions,
      roleNames,
    };
  }

  /**
   * Send account linking verification email.
   */
  private async sendLinkVerificationEmail(
    email: string,
    token: string,
    providerKey: string,
  ): Promise<void> {
    if (!this.emailService.isAvailable()) {
      this.logger.warn('Email service not available, skipping link verification email');
      return;
    }

    const apiPrefix = this.configService.get<string>('app.apiPrefix', 'api');
    const linkUrl = `${this.backendUrl}/${apiPrefix}/v1/auth/providers/link/verify?token=${token}`;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Link Your Account</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 10px 10px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 24px;">${this.appName}</h1>
  </div>
  <div style="background: #ffffff; padding: 30px; border: 1px solid #e0e0e0; border-top: none; border-radius: 0 0 10px 10px;">
    <h2 style="color: #333; margin-top: 0;">Link Your ${providerKey} Account</h2>
    <p>Someone tried to sign in with ${providerKey} using this email address. If this was you, click the button below to link your ${providerKey} account to your existing ${this.appName} account:</p>
    <div style="text-align: center; margin: 30px 0;">
      <a href="${linkUrl}" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 14px 28px; text-decoration: none; border-radius: 5px; font-weight: bold; display: inline-block;">Link Account</a>
    </div>
    <p style="color: #666; font-size: 14px;">If the button doesn't work, copy and paste this link into your browser:</p>
    <p style="color: #667eea; font-size: 14px; word-break: break-all;">${linkUrl}</p>
    <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;">
    <p style="color: #999; font-size: 12px;">This link will expire in 24 hours. If you didn't attempt this sign-in, you can safely ignore this email.</p>
  </div>
</body>
</html>`;

    const text = `
Link Your ${providerKey} Account

Someone tried to sign in with ${providerKey} using this email address. If this was you, click the link below to link your ${providerKey} account to your existing ${this.appName} account:

${linkUrl}

This link will expire in 24 hours. If you didn't attempt this sign-in, you can safely ignore this email.
`;

    const result = await this.emailService.send({
      to: email,
      subject: `Link your ${providerKey} account - ${this.appName}`,
      html,
      text,
    });

    if (!result.success) {
      this.logger.error('Failed to send link verification email', { email, error: result.error });
    }
  }
}
