import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type SharedTeamDocument = HydratedDocument<SharedTeam>;

/** A grant of access to a team from its owner to another user. */
@Schema({
  timestamps: true,
  collection: 'shared_teams',
})
export class SharedTeam extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Team', required: true, index: true })
  teamId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  sharedBy!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  sharedWith!: Types.ObjectId;

  @Prop({ type: String, enum: ['read', 'write'], default: 'read', required: true })
  permission!: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const SharedTeamSchema = SchemaFactory.createForClass(SharedTeam);

// Indexes
SharedTeamSchema.index({ teamId: 1, sharedWith: 1 }, { unique: true });
SharedTeamSchema.index({ sharedWith: 1, createdAt: -1 });
SharedTeamSchema.index({ sharedBy: 1 });

// JSON transform
SharedTeamSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
