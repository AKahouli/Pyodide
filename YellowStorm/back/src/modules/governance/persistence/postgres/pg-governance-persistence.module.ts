import { Module } from '@nestjs/common';
import { PgGroupLookupAdapter } from './pg-group-lookup.adapter';
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

/** PostgreSQL bindings for the governance store tokens. */
@Module({
  providers: [
    PgGroupLookupAdapter,
    PgProgramStore,
    PgScopeStore,
    PgGovernanceDocumentStore,
    PgGovernanceEventStore,
    PgBindingStore,
    PgReconciliationRunStore,
    PgMembershipStore,
    PgDeploymentStore,
    PgRevisionStore,
    PgDryRunStore,
    PgPublicationAttemptStore,
    PgMetricStore,
    PgGovernanceTransactionRunner,
  ],
  exports: [
    PgGroupLookupAdapter,
    PgProgramStore,
    PgScopeStore,
    PgGovernanceDocumentStore,
    PgGovernanceEventStore,
    PgBindingStore,
    PgReconciliationRunStore,
    PgMembershipStore,
    PgDeploymentStore,
    PgRevisionStore,
    PgDryRunStore,
    PgPublicationAttemptStore,
    PgMetricStore,
    PgGovernanceTransactionRunner,
  ],
})
export class PgGovernancePersistenceModule {}
