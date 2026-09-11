import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserGroupModule } from '@modules/user-group';
import { GovernanceScope, GovernanceScopeSchema } from './schemas/governance-scope.schema';
import { GovernanceDeployment, GovernanceDeploymentSchema } from './schemas/governance-deployment.schema';
import { GovernanceDeploymentRevision, GovernanceDeploymentRevisionSchema } from './schemas/governance-deployment-revision.schema';
import { GovernanceAudienceAuthorizationService } from './services/governance-audience-authorization.service';
import { GovernedConversationRuntimeService } from './services/governed-conversation-runtime.service';

@Module({
  imports: [UserGroupModule, MongooseModule.forFeature([
    { name: GovernanceScope.name, schema: GovernanceScopeSchema },
    { name: GovernanceDeployment.name, schema: GovernanceDeploymentSchema },
    { name: GovernanceDeploymentRevision.name, schema: GovernanceDeploymentRevisionSchema },
  ])],
  providers: [GovernanceAudienceAuthorizationService, GovernedConversationRuntimeService],
  exports: [GovernanceAudienceAuthorizationService, GovernedConversationRuntimeService],
})
export class GovernanceRuntimeModule {}
