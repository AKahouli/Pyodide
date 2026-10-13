import { createParamDecorator, ExecutionContext, NotFoundException } from '@nestjs/common';
import type { AppBuilderResolvedSession } from '../services/app-builder-session-access.service';

interface RequestWithSession {
  appBuilderSession?: AppBuilderResolvedSession;
}

/** Session pointer resolved by AppBuilderOwnerGuard (owner or shared participant). */
export const CurrentAppBuilderSession = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AppBuilderResolvedSession => {
    const req = ctx.switchToHttp().getRequest<RequestWithSession>();
    if (!req.appBuilderSession) {
      throw new NotFoundException('Session not found');
    }
    return req.appBuilderSession;
  },
);
