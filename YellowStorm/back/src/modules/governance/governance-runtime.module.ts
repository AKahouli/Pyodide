import { Module } from '@nestjs/common';
import { UserGroupModule } from '@modules/user-group';
import { GovernanceAudienceAuthorizationService } from './services/governance-audience-authorization.service';
import { GovernedConversationRuntimeService } from './services/governed-conversation-runtime.service';
import { PgGovernancePersistenceModule } from './persistence/postgres/pg-governance-persistence.module';

@Module({
  imports: [UserGroupModule, PgGovernancePersistenceModule],
  providers: [GovernanceAudienceAuthorizationService, GovernedConversationRuntimeService],
  exports: [GovernanceAudienceAuthorizationService, GovernedConversationRuntimeService],
})
export class GovernanceRuntimeModule {}
