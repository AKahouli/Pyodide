import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { ForbiddenException } from '../../exceptions';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import { AppBuilderAiSettingsService } from '../services/app-builder-ai-settings.service';
import { isAppBuilderAiProxyMode } from '../utils/app-builder-ai-mode';

type AiProxyAuthedRequest = Request & {
  aiProxyAuth?: { mode?: 'platform' | 'app_end_user' | 'ai_preview' };
};

/**
 * Blocks App Builder AI Proxy traffic when the admin kill switch is off.
 * Platform JWT traffic is never affected.
 */
@Injectable()
export class AppBuilderAiKillSwitchGuard implements CanActivate {
  constructor(private readonly settings: AppBuilderAiSettingsService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AiProxyAuthedRequest>();
    const mode = request.aiProxyAuth?.mode;
    if (!isAppBuilderAiProxyMode(mode)) {
      return true;
    }
    if (this.settings.isEnabled()) {
      return true;
    }
    throw new ForbiddenException(
      ErrorCode.APP_BUILDER_AI_DISABLED,
      'App Builder AI access is currently disabled by an administrator',
    );
  }
}
