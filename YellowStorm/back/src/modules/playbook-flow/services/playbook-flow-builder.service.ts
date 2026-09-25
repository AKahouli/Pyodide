import { Injectable } from '@nestjs/common';
import { flowToSnapshot, FlowSnapshot, type FlowSnapshotSource } from '../mappers/flow-to-snapshot.mapper';

@Injectable()
export class PlaybookFlowBuilderService {
  buildSnapshot(flow: FlowSnapshotSource): FlowSnapshot {
    return flowToSnapshot(flow);
  }
}
