import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { GovernanceProgram, GovernanceProgramDocument } from './schemas/governance-program.schema';
import { type GovernanceProgramCreateInput, type GovernanceProgramPatch, type ProgramStore } from '../program-store';import type { GovernanceProgramRecord } from '../governance-records';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export function programToRecord(doc: Row): GovernanceProgramRecord {
  return {
    id: doc._id.toString(),
    name: doc.name,
    description: doc.description,
    domain: doc.domain,
    defaultLanguage: doc.defaultLanguage,
    status: doc.status,
    ownerUserId: doc.ownerUserId.toString(),
    metadata: doc.metadata ?? {},
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

@Injectable()
export class MongoProgramStore implements ProgramStore {
  constructor(@InjectModel(GovernanceProgram.name) private readonly model: Model<GovernanceProgramDocument>) {}

  async insert(input: GovernanceProgramCreateInput): Promise<GovernanceProgramRecord> {
    const created = await this.model.create({ ...input, ownerUserId: new Types.ObjectId(input.ownerUserId) });
    return programToRecord(created);
  }

  async findById(id: string): Promise<GovernanceProgramRecord | null> {
    const found = await this.model.findById(id).lean().exec();
    return found ? programToRecord(found) : null;
  }

  async findByOwnerAndName(ownerUserId: string, name: string): Promise<GovernanceProgramRecord | null> {
    const found = await this.model.findOne({ ownerUserId: new Types.ObjectId(ownerUserId), name }).lean().exec();
    return found ? programToRecord(found) : null;
  }

  async findByOwnerAndId(ownerUserId: string, programId: string): Promise<GovernanceProgramRecord | null> {
    const found = await this.model.findOne({ _id: new Types.ObjectId(programId), ownerUserId: new Types.ObjectId(ownerUserId) }).lean().exec();
    return found ? programToRecord(found) : null;
  }

  async listForOwner(ownerUserId: string, memberProgramIds: string[]): Promise<GovernanceProgramRecord[]> {
    const programs = await this.model
      .find({
        $or: [
          { ownerUserId: new Types.ObjectId(ownerUserId) },
          { _id: { $in: memberProgramIds.map((id) => new Types.ObjectId(id)) } },
        ],
      })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();
    return programs.map(programToRecord);
  }

  async update(id: string, patch: GovernanceProgramPatch): Promise<GovernanceProgramRecord | null> {
    const updated = await this.model.findOneAndUpdate({ _id: new Types.ObjectId(id) }, { $set: patch }, { new: true }).exec();
    return updated ? programToRecord(updated) : null;
  }

  async deleteById(id: string): Promise<void> {
    await this.model.deleteOne({ _id: new Types.ObjectId(id) }).exec();
  }
}
