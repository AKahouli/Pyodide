import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../auth/decorators/public.decorator';
import { PermissionsGuard } from './permissions.guard';

/**
 * Global-only variant of `PermissionsGuard` used as the app-wide `APP_GUARD`.
 *
 * It is identical to `PermissionsGuard` except that it **skips `@Public()`
 * routes** — those opt out of the JWT pipeline (no `request.user`) and own their
 * authorization through their own guards (e.g. the internal-service surface runs
 * an actor guard that populates `request.user` after the global guards).
 *
 * The public-skip deliberately lives ONLY here, not in `PermissionsGuard`, so
 * that explicit `@UseGuards(PermissionsGuard)` usages (including on `@Public()`
 * controllers such as `semantic-model-assistant-internal`) keep enforcing.
 */
@Injectable()
export class GlobalPermissionsGuard extends PermissionsGuard implements CanActivate {
  constructor(private readonly globalReflector: Reflector) {
    super(globalReflector);
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.globalReflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }
}
