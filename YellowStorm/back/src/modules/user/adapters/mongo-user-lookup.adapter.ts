import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { UserLookupPort, type UserSummary } from '@common/ports/user-lookup.port';
import { User, type UserDocument } from '../schemas/user.schema';

interface UserLookupRow {
  _id: unknown;
  email?: string;
  profile?: { firstName?: string; lastName?: string };
}

@Injectable()
export class MongoUserLookupAdapter implements UserLookupPort {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  async byId(id: string): Promise<UserSummary | null> {
    return (await this.byIds([id])).get(id) ?? null;
  }

  async byIds(ids: string[]): Promise<Map<string, UserSummary>> {
    const wanted = [...new Set(ids.filter(Boolean))];
    const map = new Map<string, UserSummary>();
    if (wanted.length === 0) return map;
    // Mongoose casts 24-hex strings to the _id type declared on the schema.
    const rows = (await this.userModel
      .find({ _id: { $in: wanted } })
      .select('email profile.firstName profile.lastName')
      .lean()) as unknown as UserLookupRow[];
    for (const row of rows) {
      const id = String(row._id);
      map.set(id, {
        id,
        email: row.email ?? '',
        firstName: row.profile?.firstName ?? '',
        lastName: row.profile?.lastName ?? '',
      });
    }
    return map;
  }
}
