import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UserGroup, UserGroupSchema } from '@modules/user-group/schemas/user-group.schema';
import { MongoGroupLookupAdapter } from '../mongo/mongo-group-lookup.adapter';
import { PgProgramStore } from './pg-program.store';
import { PgScopeStore } from './pg-scope.store';
import { PgGovernanceDocumentStore } from './pg-document.store';
import { PgGovernanceEventStore } from './pg-document-event.store';
import { PgBindingStore } from './pg-binding.store';
import { PgReconciliationRunStore } from './pg-reconciliation-run.store';
import { PgMembershipStore } from './pg-membership.store';
import { PgDeploymentStore } from './pg-deployment.store';
import { PgRevisionStore } from './pg-revision.store';
import { PgDryRunStore } from './pg-dry-run.store';
import { PgPublicationAttemptStore } from './pg-publication-attempt.store';
import { PgMetricStore } from './pg-metric.store';
import { PgGovernanceTransactionRunner } from './pg-transaction-runner';
import {
  BINDING_STORE,
  DEPLOYMENT_STORE,
  DRY_RUN_STORE,
  GOVERNANCE_DOCUMENT_STORE,
  GOVERNANCE_EVENT_STORE,
  GOVERNANCE_TRANSACTION,
  GROUP_LOOKUP_PORT,
  MEMBERSHIP_STORE,
  METRIC_STORE,
  PROGRAM_STORE,
  PUBLICATION_ATTEMPT_STORE,
  RECONCILIATION_RUN_STORE,
  REVISION_STORE,
  SCOPE_STORE,
} from '../index';

// Groups are out of migration scope: the membership populate group lookup stays Mongo-backed.
const GROUP_LOOKUP_MONGO = MongooseModule.forFeature([{ name: UserGroup.name, schema: UserGroupSchema }]);

/** PostgreSQL bindings for the governance store tokens. */
@Module({
  imports: [GROUP_LOOKUP_MONGO],
  providers: [
    PgProgramStore,
    { provide: PROGRAM_STORE, useExisting: PgProgramStore },
    PgScopeStore,
    { provide: SCOPE_STORE, useExisting: PgScopeStore },
    PgGovernanceDocumentStore,
    { provide: GOVERNANCE_DOCUMENT_STORE, useExisting: PgGovernanceDocumentStore },
    PgGovernanceEventStore,
    { provide: GOVERNANCE_EVENT_STORE, useExisting: PgGovernanceEventStore },
    PgBindingStore,
    { provide: BINDING_STORE, useExisting: PgBindingStore },
    PgReconciliationRunStore,
    { provide: RECONCILIATION_RUN_STORE, useExisting: PgReconciliationRunStore },
    PgMembershipStore,
    { provide: MEMBERSHIP_STORE, useExisting: PgMembershipStore },
    PgDeploymentStore,
    { provide: DEPLOYMENT_STORE, useExisting: PgDeploymentStore },
    PgRevisionStore,
    { provide: REVISION_STORE, useExisting: PgRevisionStore },
    PgDryRunStore,
    { provide: DRY_RUN_STORE, useExisting: PgDryRunStore },
    PgPublicationAttemptStore,
    { provide: PUBLICATION_ATTEMPT_STORE, useExisting: PgPublicationAttemptStore },
    PgMetricStore,
    { provide: METRIC_STORE, useExisting: PgMetricStore },
    PgGovernanceTransactionRunner,
    { provide: GOVERNANCE_TRANSACTION, useExisting: PgGovernanceTransactionRunner },
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
    GOVERNANCE_TRANSACTION,
  ],
})
export class PgGovernancePersistenceModule {}
