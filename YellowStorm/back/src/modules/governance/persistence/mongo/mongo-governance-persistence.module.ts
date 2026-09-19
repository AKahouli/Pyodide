import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { GovernanceProgram, GovernanceProgramSchema } from './schemas/governance-program.schema';
import { GovernanceScope, GovernanceScopeSchema } from './schemas/governance-scope.schema';
import { GovernanceDocument, GovernanceDocumentSchema } from './schemas/governance-document.schema';
import { GovernanceDocumentEvent, GovernanceDocumentEventSchema } from './schemas/governance-document-event.schema';
import { GovernanceWorkspaceBinding, GovernanceWorkspaceBindingSchema } from './schemas/governance-workspace-binding.schema';
import { GovernanceReconciliationRun, GovernanceReconciliationRunSchema } from './schemas/governance-reconciliation-run.schema';
import { GovernanceMembership, GovernanceMembershipSchema } from './schemas/governance-membership.schema';
import { GovernanceDeployment, GovernanceDeploymentSchema } from './schemas/governance-deployment.schema';
import { GovernanceDeploymentRevision, GovernanceDeploymentRevisionSchema } from './schemas/governance-deployment-revision.schema';
import { GovernanceDryRun, GovernanceDryRunSchema } from './schemas/governance-dry-run.schema';
import { GovernanceMetric, GovernanceMetricSchema } from './schemas/governance-metric.schema';
import { GovernancePublicationAttempt, GovernancePublicationAttemptSchema } from './schemas/governance-publication-attempt.schema';
import { UserGroup, UserGroupSchema } from '@modules/user-group/schemas/user-group.schema';
import { MongoProgramStore } from './mongo-program.store';
import { MongoScopeStore } from './mongo-scope.store';
import { MongoGovernanceDocumentStore } from './mongo-document.store';
import { MongoGovernanceEventStore } from './mongo-document-event.store';
import { MongoBindingStore } from './mongo-binding.store';
import { MongoReconciliationRunStore } from './mongo-reconciliation-run.store';
import { MongoMembershipStore } from './mongo-membership.store';
import { MongoDeploymentStore } from './mongo-deployment.store';
import { MongoRevisionStore } from './mongo-revision.store';
import { MongoDryRunStore } from './mongo-dry-run.store';
import { MongoPublicationAttemptStore } from './mongo-publication-attempt.store';
import { MongoMetricStore } from './mongo-metric.store';
import { MongoGroupLookupAdapter } from './mongo-group-lookup.adapter';
import {
  BINDING_STORE,
  DEPLOYMENT_STORE,
  DRY_RUN_STORE,
  GOVERNANCE_DOCUMENT_STORE,
  GOVERNANCE_EVENT_STORE,
  GROUP_LOOKUP_PORT,
  MEMBERSHIP_STORE,
  METRIC_STORE,
  PROGRAM_STORE,
  PUBLICATION_ATTEMPT_STORE,
  RECONCILIATION_RUN_STORE,
  REVISION_STORE,
  SCOPE_STORE,
} from '../index';

/**
 * MongoDB bindings for the governance store tokens — the pre-cutover wiring.
 * Kept through the Step E cutover so rollback is an import swap (see
 * PgGovernancePersistenceModule). Removed together with governance/schemas/
 * once MongoDB is dropped for this domain.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: GovernanceProgram.name, schema: GovernanceProgramSchema },
      { name: GovernanceScope.name, schema: GovernanceScopeSchema },
      { name: GovernanceDocument.name, schema: GovernanceDocumentSchema },
      { name: GovernanceDocumentEvent.name, schema: GovernanceDocumentEventSchema },
      { name: GovernanceWorkspaceBinding.name, schema: GovernanceWorkspaceBindingSchema },
      { name: GovernanceReconciliationRun.name, schema: GovernanceReconciliationRunSchema },
      { name: GovernanceMembership.name, schema: GovernanceMembershipSchema },
      { name: GovernanceDeployment.name, schema: GovernanceDeploymentSchema },
      { name: GovernanceDeploymentRevision.name, schema: GovernanceDeploymentRevisionSchema },
      { name: GovernanceDryRun.name, schema: GovernanceDryRunSchema },
      { name: GovernanceMetric.name, schema: GovernanceMetricSchema },
      { name: GovernancePublicationAttempt.name, schema: GovernancePublicationAttemptSchema },
      { name: UserGroup.name, schema: UserGroupSchema },
    ]),
  ],
  providers: [
    MongoProgramStore,
    { provide: PROGRAM_STORE, useExisting: MongoProgramStore },
    MongoScopeStore,
    { provide: SCOPE_STORE, useExisting: MongoScopeStore },
    MongoGovernanceDocumentStore,
    { provide: GOVERNANCE_DOCUMENT_STORE, useExisting: MongoGovernanceDocumentStore },
    MongoGovernanceEventStore,
    { provide: GOVERNANCE_EVENT_STORE, useExisting: MongoGovernanceEventStore },
    MongoBindingStore,
    { provide: BINDING_STORE, useExisting: MongoBindingStore },
    MongoReconciliationRunStore,
    { provide: RECONCILIATION_RUN_STORE, useExisting: MongoReconciliationRunStore },
    MongoMembershipStore,
    { provide: MEMBERSHIP_STORE, useExisting: MongoMembershipStore },
    MongoDeploymentStore,
    { provide: DEPLOYMENT_STORE, useExisting: MongoDeploymentStore },
    MongoRevisionStore,
    { provide: REVISION_STORE, useExisting: MongoRevisionStore },
    MongoDryRunStore,
    { provide: DRY_RUN_STORE, useExisting: MongoDryRunStore },
    MongoPublicationAttemptStore,
    { provide: PUBLICATION_ATTEMPT_STORE, useExisting: MongoPublicationAttemptStore },
    MongoMetricStore,
    { provide: METRIC_STORE, useExisting: MongoMetricStore },
    MongoGroupLookupAdapter,
    { provide: GROUP_LOOKUP_PORT, useExisting: MongoGroupLookupAdapter },
  ],
  exports: [
    PROGRAM_STORE,
    SCOPE_STORE,
    GOVERNANCE_DOCUMENT_STORE,
    GOVERNANCE_EVENT_STORE,
    BINDING_STORE,
    RECONCILIATION_RUN_STORE,
    MEMBERSHIP_STORE,
    DEPLOYMENT_STORE,
    REVISION_STORE,
    DRY_RUN_STORE,
    PUBLICATION_ATTEMPT_STORE,
    METRIC_STORE,
    GROUP_LOOKUP_PORT,
  ],
})
export class MongoGovernancePersistenceModule {}
