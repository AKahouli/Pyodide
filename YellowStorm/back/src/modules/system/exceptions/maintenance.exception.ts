import { HttpStatus } from '@nestjs/common';
import { MaintenanceStatus } from '../interfaces/maintenance.interface';

export class MaintenanceException extends Error {
  public readonly statusCode = HttpStatus.SERVICE_UNAVAILABLE;
  public readonly code = 'MAINTENANCE_MODE';
  public readonly maintenance: MaintenanceStatus;

  constructor(maintenance: MaintenanceStatus) {
    super(maintenance.message || 'System is under maintenance');
    this.maintenance = maintenance;
    this.name = 'MaintenanceException';
    Error.captureStackTrace(this, this.constructor);
  }
}
