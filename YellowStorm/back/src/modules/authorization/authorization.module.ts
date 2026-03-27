import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthorizationService } from './authorization.service';
import { AuditLogService } from './services/audit-log.service';
import { RolesController } from './controllers/roles.controller';
import { AuditLogsController } from './controllers/audit-logs.controller';
import { AdminLogsController } from './controllers/admin-logs.controller';
import { PermissionsGuard } from './guards/permissions.guard';
import { Role, RoleSchema } from './schemas/role.schema';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';
import { UserModule } from '../user';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Role.name, schema: RoleSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
    ]),
    forwardRef(() => UserModule),
  ],
  controllers: [RolesController, AuditLogsController, AdminLogsController],
  providers: [AuthorizationService, AuditLogService, PermissionsGuard],
  exports: [AuthorizationService, AuditLogService, PermissionsGuard],
})
export class AuthorizationModule {}
