import { Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import { Flow, type FlowDocument } from '../schemas/playbook-flow.schema';
import { FLOW_READ_PORT, type FlowReadPort } from './flow-read.port';

@Injectable()
export class MongoFlowReadAdapter implements FlowReadPort {
  constructor(@InjectModel(Flow.name) private readonly flowModel: Model<FlowDocument>) {}

  async findById(id: string): Promise<{ id: string; ownerId: string } | null> {
    const doc = await this.flowModel.findById(id).select({ _id: 1, ownerId: 1 }).lean().exec();
    return doc ? { id: String(doc._id), ownerId: String(doc.ownerId ?? '') } : null;
  }

  async removeWorkspaceReference(workspaceId: string): Promise<void> {
    // Legacy quirk preserved: ObjectId values against the string[] schema.
    await this.flowModel
      .updateMany({ workspaces: new Types.ObjectId(workspaceId) }, { $pull: { workspaces: new Types.ObjectId(workspaceId) } })
      .exec();
  }
}
