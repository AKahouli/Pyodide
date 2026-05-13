import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { SystemService } from '../system.service';
import { SKIP_MAINTENANCE_KEY } from '../decorators/skip-maintenance.decorator';
import { MaintenanceException } from '../exceptions/maintenance.exception';
import { hasPermission } from '../../authorization/constants/permissions';

// Routes that should always bypass maintenance (by path pattern)
const WHITELISTED_PATHS = [
  /^\/api\/v\d+\/health/,           // Health endpoints
  /^\/api\/v\d+\/system\/maintenance/, // Maintenance status endpoint
];

@Injectable()
export class MaintenanceGuard implements CanActivate {
  private readonly isDevelopment: boolean;

  constructor(
    private readonly reflector: Reflector,
    private readonly systemService: SystemService,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {
    this.isDevelopment = this.configService.get<string>('app.nodeEnv') === 'development';
  }

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    // Skip maintenance check entirely in development
    if (this.isDevelopment) {
      return true;
    }

    // Always allow OPTIONS preflight requests for CORS
    if (request.method === 'OPTIONS') {
      return true;
    }

    // Check if route has @SkipMaintenance() decorator
    const skipMaintenance = this.reflector.getAllAndOverride<boolean>(
      SKIP_MAINTENANCE_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (skipMaintenance) {
      return true;
    }

    // Check path-based whitelist
    const path = request.path;

    for (const pattern of WHITELISTED_PATHS) {
      if (pattern.test(path)) {
        return true;
      }
    }

    // Check maintenance status (sync for performance)
    const status = this.systemService.getMaintenanceStatusSync();

    if (status.enabled) {
      if (this.hasSkipMaintenancePermission(request)) {
        return true;
      }
      throw new MaintenanceException(status);
    }

    return true;
  }

  /**
   * Manually extract and verify the JWT to check if the user
   * has the system.skip_maintenance permission.
   * This is needed because MaintenanceGuard runs before JwtAuthGuard,
   * so request.user is not yet populated.
   */
  private hasSkipMaintenancePermission(request: Request): boolean {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return false;
      }

      const token = authHeader.slice(7);
      const payload = this.jwtService.verify(token);
      const permissions: string[] = payload.permissions ?? [];

      return hasPermission(permissions, 'system.skip_maintenance');
    } catch {
      return false;
    }
  }
}
