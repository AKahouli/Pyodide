import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type SharedAgentDocument = HydratedDocument<SharedAgent>;

/** A grant of access to a (personal) agent from its owner to another user. */
@Schema({
  timestamps: true,
  collection: 'shared_agents',
})
export class SharedAgent extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Agent', required: true, index: true })
  agentId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  sharedBy!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  sharedWith!: Types.ObjectId;

  @Prop({ type: String, enum: ['read', 'write'], default: 'read', required: true })
  permission!: string;

  createdAt!: Date;
  updatedAt!: Date;
}

export const SharedAgentSchema = SchemaFactory.createForClass(SharedAgent);

// Indexes
SharedAgentSchema.index({ agentId: 1, sharedWith: 1 }, { unique: true });
SharedAgentSchema.index({ sharedWith: 1, createdAt: -1 });
SharedAgentSchema.index({ sharedBy: 1 });

// JSON transform
SharedAgentSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
