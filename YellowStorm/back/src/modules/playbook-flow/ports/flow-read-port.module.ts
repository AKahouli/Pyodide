import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Flow, FlowSchema } from '../schemas/playbook-flow.schema';
import { FLOW_READ_PORT } from './flow-read.port';
import { MongoFlowReadAdapter } from './mongo-flow-read.adapter';

/**
 * Global binding for FLOW_READ_PORT so consumers (workspace, classifier) can
 * inject the port WITHOUT importing PlaybookFlowModule — that import edge
 * creates a CommonJS evaluation cycle (workspace → playbook-flow → connector
 * → workspace) which breaks app boot.
 */
@Global()
@Module({
  imports: [MongooseModule.forFeature([{ name: Flow.name, schema: FlowSchema }])],
  providers: [MongoFlowReadAdapter, { provide: FLOW_READ_PORT, useExisting: MongoFlowReadAdapter }],
  exports: [FLOW_READ_PORT],
})
export class FlowReadPortModule {}
