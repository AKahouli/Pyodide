import { SetMetadata } from '@nestjs/common';

export const SKIP_MAINTENANCE_KEY = 'skipMaintenance';

/**
 * Decorator to mark endpoints that should bypass maintenance mode.
 * Use this on controllers or specific route handlers that must remain
 * accessible during maintenance (e.g., health checks, admin endpoints).
 */
export const SkipMaintenance = () => SetMetadata(SKIP_MAINTENANCE_KEY, true);
