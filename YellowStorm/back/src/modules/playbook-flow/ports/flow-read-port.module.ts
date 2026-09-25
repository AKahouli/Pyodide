import { Global, Module } from '@nestjs/common';
import { FlowRepository } from '../persistence/flow.repository';
import { FLOW_READ_PORT } from './flow-read.port';
import { PgFlowReadAdapter } from './pg-flow-read.adapter';

/**
 * Global binding for FLOW_READ_PORT so consumers (workspace, classifier) can
 * inject the port WITHOUT importing PlaybookFlowModule — that import edge
 * creates a CommonJS evaluation cycle (workspace → playbook-flow → connector
 * → workspace) which breaks app boot.
 */
@Global()
@Module({
  providers: [FlowRepository, PgFlowReadAdapter, { provide: FLOW_READ_PORT, useExisting: PgFlowReadAdapter }],
  exports: [FLOW_READ_PORT],
})
export class FlowReadPortModule {}
