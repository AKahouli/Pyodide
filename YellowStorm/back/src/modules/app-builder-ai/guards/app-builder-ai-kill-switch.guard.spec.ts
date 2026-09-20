import { AppBuilderAiKillSwitchGuard } from './app-builder-ai-kill-switch.guard';
import { ForbiddenException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';

describe('AppBuilderAiKillSwitchGuard', () => {
  const settings = { isEnabled: jest.fn() };
  const createGuard = () =>
    new AppBuilderAiKillSwitchGuard(settings as never);

  const ctx = (mode?: string) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ aiProxyAuth: mode ? { mode } : undefined }),
      }),
    }) as never;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('allows platform traffic even when disabled', () => {
    settings.isEnabled.mockReturnValue(false);
    expect(createGuard().canActivate(ctx('platform'))).toBe(true);
  });

  it('allows app builder traffic when enabled', () => {
    settings.isEnabled.mockReturnValue(true);
    expect(createGuard().canActivate(ctx('ai_preview'))).toBe(true);
    expect(createGuard().canActivate(ctx('app_end_user'))).toBe(true);
  });

  it('blocks app builder traffic when disabled', () => {
    settings.isEnabled.mockReturnValue(false);
    try {
      createGuard().canActivate(ctx('ai_preview'));
      fail('expected ForbiddenException');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).code).toBe(ErrorCode.APP_BUILDER_AI_DISABLED);
    }
  });
});
