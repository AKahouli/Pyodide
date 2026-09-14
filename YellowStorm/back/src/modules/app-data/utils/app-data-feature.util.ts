import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

/**
 * Shared feature-flag assertions for App Data controllers.
 * Eliminates duplication between local and remote owner controllers.
 */
export function assertAppDataEnabled(config: ConfigService): void {
  if (
    !config.get<boolean>('appData.enabled', false) ||
    !config.get<boolean>('appData.dataTabEnabled', false)
  ) {
    throw new ServiceUnavailableException('App Data owner API is disabled');
  }
}

export function assertEndUserManagementEnabled(config: ConfigService): void {
  if (
    !config.get<boolean>('appData.enabled', false) ||
    !config.get<boolean>('appData.endUserAuthEnabled', true)
  ) {
    throw new ServiceUnavailableException('App Data end-user management is disabled');
  }
}
