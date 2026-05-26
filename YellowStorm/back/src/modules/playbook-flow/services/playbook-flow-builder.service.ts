import { Injectable } from '@nestjs/common';
import { Flow } from '../schemas/playbook-flow.schema';
import { flowToSnapshot, FlowSnapshot } from '../mappers/flow-to-snapshot.mapper';

@Injectable()
export class PlaybookFlowBuilderService {
  buildSnapshot(flow: Flow): FlowSnapshot {
    return flowToSnapshot(flow);
  }
}
