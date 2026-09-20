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
import { User, UserSchema } from '../user/schemas/user.schema';
import { ROLE_STORE } from './persistence/role.store';
import { MongoRoleStore } from './persistence/mongo-role.store';
import { PgRoleStore } from './persistence/pg-role.store';
import { AUDIT_LOG_STORE } from './persistence/audit-log.store';
import { MongoAuditLogStore } from './persistence/mongo-role.store';
import { PgAuditLogStore } from './persistence/pg-role.store';
import { UserModule } from '../user';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Role.name, schema: RoleSchema },
      { name: AuditLog.name, schema: AuditLogSchema },
      { name: User.name, schema: UserSchema }, // MongoRoleStore detach/bump (until 1A cutover)
    ]),
    forwardRef(() => UserModule),
  ],
  controllers: [RolesController, AuditLogsController, AdminLogsController],
  providers: [
    AuthorizationService,
    AuditLogService,
    PermissionsGuard,
    { provide: ROLE_STORE, useClass: MongoRoleStore },
    { provide: AUDIT_LOG_STORE, useClass: MongoAuditLogStore },
    PgRoleStore,
    PgAuditLogStore,
  ],
  exports: [AuthorizationService, AuditLogService, PermissionsGuard, ROLE_STORE, AUDIT_LOG_STORE],
})
export class AuthorizationModule {}
