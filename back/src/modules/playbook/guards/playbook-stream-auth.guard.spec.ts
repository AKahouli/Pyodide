import { ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PlaybookStreamAuthGuard } from './playbook-stream-auth.guard';
import { UnauthorizedException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { JwtPayload } from '../../auth/interfaces/jwt-payload.interface';
import { AuthService } from '../../auth/auth.service';

describe('PlaybookStreamAuthGuard', () => {
  let guard: PlaybookStreamAuthGuard;
  let jwtService: jest.Mocked<Pick<JwtService, 'verify'>>;
  let configService: jest.Mocked<Pick<ConfigService, 'get'>>;
  let authService: jest.Mocked<Pick<AuthService, 'isSessionValid'>>;

  const validPayload: JwtPayload = {
    sub: 'user-123',
    email: 'test@example.com',
    type: 'access',
    sessionId: 'session-456',
    permissions: [],
    roleNames: ['user'],
    permissionsVersion: 1,
  };

  const createMockContext = (query: Record<string, string> = {}): {
    context: ExecutionContext;
    request: Record<string, any>;
  } => {
    const request: Record<string, any> = { query };
    return {
      request,
      context: {
        switchToHttp: () => ({
          getRequest: () => request,
        }),
      } as unknown as ExecutionContext,
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();

    jwtService = { verify: jest.fn().mockReturnValue(validPayload) };
    configService = {
      get: jest.fn().mockImplementation((key: string) => {
        const map: Record<string, string> = {
          'jwt.secret': 'test-secret',
          'jwt.issuer': 'test-issuer',
          'jwt.audience': 'test-audience',
        };
        return map[key];
      }),
    };
    authService = { isSessionValid: jest.fn().mockResolvedValue(true) };

    guard = new PlaybookStreamAuthGuard(
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
      authService as unknown as AuthService,
    );
  });

  it('should reject when no token is provided', async () => {
    const { context } = createMockContext({});

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should reject with AUTH_TOKEN_MISSING when token is absent', async () => {
    const { context } = createMockContext({});

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: ErrorCode.AUTH_TOKEN_MISSING,
    });
  });

  it('should verify the token with correct JWT options', async () => {
    const { context } = createMockContext({ token: 'valid-jwt' });

    await guard.canActivate(context);

    expect(jwtService.verify).toHaveBeenCalledWith('valid-jwt', {
      secret: 'test-secret',
      issuer: 'test-issuer',
      audience: 'test-audience',
    });
  });

  it('should reject when token type is not access', async () => {
    jwtService.verify.mockReturnValue({ ...validPayload, type: 'refresh' } as any);
    const { context } = createMockContext({ token: 'refresh-jwt' });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('should reject with AUTH_TOKEN_INVALID for non-access token type', async () => {
    jwtService.verify.mockReturnValue({ ...validPayload, type: 'refresh' } as any);
    const { context } = createMockContext({ token: 'refresh-jwt' });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: ErrorCode.AUTH_TOKEN_INVALID,
    });
  });

  it('should set request.sseUser on success', async () => {
    const { context, request } = createMockContext({ token: 'valid-jwt' });

    await guard.canActivate(context);

    expect(request.sseUser).toEqual(validPayload);
  });

  it('should validate session when sessionId is present', async () => {
    const { context } = createMockContext({ token: 'valid-jwt' });

    await guard.canActivate(context);

    expect(authService.isSessionValid).toHaveBeenCalledWith('session-456');
  });

  it('should reject with AUTH_SESSION_REVOKED when session is invalid', async () => {
    authService.isSessionValid.mockResolvedValue(false);
    const { context } = createMockContext({ token: 'valid-jwt' });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: ErrorCode.AUTH_SESSION_REVOKED,
    });
  });

  it('should skip session validation when sessionId is absent', async () => {
    jwtService.verify.mockReturnValue({ ...validPayload, sessionId: undefined } as any);
    const { context } = createMockContext({ token: 'valid-jwt' });

    await guard.canActivate(context);

    expect(authService.isSessionValid).not.toHaveBeenCalled();
  });

  it('should reject with AUTH_TOKEN_INVALID on expired/malformed token', async () => {
    jwtService.verify.mockImplementation(() => {
      throw new Error('jwt expired');
    });
    const { context } = createMockContext({ token: 'expired-jwt' });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: ErrorCode.AUTH_TOKEN_INVALID,
    });
  });

  it('should re-throw UnauthorizedException from inner logic', async () => {
    authService.isSessionValid.mockResolvedValue(false);
    const { context } = createMockContext({ token: 'valid-jwt' });

    // The guard throws AUTH_SESSION_REVOKED inside try block — it should be re-thrown as-is
    await expect(guard.canActivate(context)).rejects.toMatchObject({
      code: ErrorCode.AUTH_SESSION_REVOKED,
    });
  });

  it('should return true on valid token with valid session', async () => {
    const { context } = createMockContext({ token: 'valid-jwt' });

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
  });
});
