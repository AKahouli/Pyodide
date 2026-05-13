export interface MaintenanceStatus {
  enabled: boolean;
  message: string;
  startedAt?: Date;
  startedBy?: string;
  estimatedEndAt?: Date;
}

export interface MaintenanceResponse {
  statusCode: 503;
  error: 'Service Unavailable';
  code: 'MAINTENANCE_MODE';
  maintenance: MaintenanceStatus;
}
