import { SetMetadata } from '@nestjs/common';
import type { AppBuilderSessionPermission } from '../constants/app-builder-session-permissions';

export const APP_BUILDER_SESSION_PERMISSION_KEY = 'appBuilderSessionPermission';

/** Require a session-scoped permission resolved by AppBuilderSessionAccessGuard. */
export const RequireAppBuilderSessionPermission = (permission: AppBuilderSessionPermission) =>
  SetMetadata(APP_BUILDER_SESSION_PERMISSION_KEY, permission);
