import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { UserGroup, UserGroupDocument } from '@modules/user-group/schemas/user-group.schema';
import { GROUP_LOOKUP_PORT, type GovernanceGroupLookupPort, type GovernanceGroupSummary } from '../group-lookup.port';

@Injectable()
export class MongoGroupLookupAdapter implements GovernanceGroupLookupPort {
  constructor(@InjectModel(UserGroup.name) private readonly groupModel: Model<UserGroupDocument>) {}

  async summariesByIds(ids: string[]): Promise<Map<string, GovernanceGroupSummary>> {
    const objectIds = [...new Set(ids)].filter((id) => Types.ObjectId.isValid(id)).map((id) => new Types.ObjectId(id));
    const summaries = new Map<string, GovernanceGroupSummary>();
    if (objectIds.length === 0) return summaries;
    const groups = await this.groupModel.find({ _id: { $in: objectIds } }).select('_id name members').lean().exec();
    for (const group of groups) {
      summaries.set(group._id.toString(), {
        id: group._id.toString(),
        name: group.name ?? '',
        memberCount: Array.isArray(group.members) ? group.members.length : 0,
      });
    }
    return summaries;
  }
}
