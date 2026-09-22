import { Module, forwardRef } from '@nestjs/common';
import { AuthorizationService } from './authorization.service';
import { AuditLogService } from './services/audit-log.service';
import { RolesController } from './controllers/roles.controller';
import { AuditLogsController } from './controllers/audit-logs.controller';
import { AdminLogsController } from './controllers/admin-logs.controller';
import { PermissionsGuard } from './guards/permissions.guard';
import { ROLE_STORE } from './persistence/role.store';
import { PgRoleStore } from './persistence/pg-role.store';
import { AUDIT_LOG_STORE } from './persistence/audit-log.store';
import { PgAuditLogStore } from './persistence/pg-role.store';
import { UserModule } from '../user';

@Module({
  imports: [
    forwardRef(() => UserModule),
  ],
  controllers: [RolesController, AuditLogsController, AdminLogsController],
  providers: [
    AuthorizationService,
    AuditLogService,
    PermissionsGuard,
    { provide: ROLE_STORE, useClass: PgRoleStore },
    { provide: AUDIT_LOG_STORE, useClass: PgAuditLogStore },
    PgRoleStore,
    PgAuditLogStore,
  ],
  exports: [AuthorizationService, AuditLogService, PermissionsGuard, ROLE_STORE, AUDIT_LOG_STORE],
})
export class AuthorizationModule {}
