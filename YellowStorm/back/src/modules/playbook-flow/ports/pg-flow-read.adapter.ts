import { Injectable } from '@nestjs/common';
import { FlowRepository } from '../persistence/flow.repository';
import type { FlowReadPort } from './flow-read.port';

@Injectable()
export class PgFlowReadAdapter implements FlowReadPort {
  constructor(private readonly flows: FlowRepository) {}

  async findById(id: string): Promise<{ id: string; ownerId: string } | null> {
    return this.flows.findOwnerRef(id);
  }

  async removeWorkspaceReference(workspaceId: string): Promise<void> {
    await this.flows.removeWorkspaceReference(workspaceId);
  }
}
