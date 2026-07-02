import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserGroup, UserGroupSchema } from './schemas/user-group.schema';
import { UserGroupService } from './user-group.service';
import { UserGroupController } from './user-group.controller';
import { UserModule } from '../user/user.module';
import { LoggerModule } from '../logger';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: UserGroup.name, schema: UserGroupSchema }]),
    UserModule,
    LoggerModule,
  ],
  controllers: [UserGroupController],
  providers: [UserGroupService],
  exports: [UserGroupService],
})
export class UserGroupModule {}
