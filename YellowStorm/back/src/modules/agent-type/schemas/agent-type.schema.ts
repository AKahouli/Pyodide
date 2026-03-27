import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';

export type AgentTypeDocument = HydratedDocument<AgentType>;

@Schema({
  timestamps: true,
  collection: 'agent_types',
})
export class AgentType extends Document {
  @Prop({ required: true, unique: true, trim: true, maxlength: 100, index: true })
  name!: string;

  @Prop({ required: true, unique: true, trim: true, maxlength: 100, index: true })
  slug!: string;

  @Prop({ default: '', maxlength: 50000 })
  defaultPrompt!: string;

  @Prop({ default: true })
  isActive!: boolean;

  createdAt!: Date;
  updatedAt!: Date;
}

export const AgentTypeSchema = SchemaFactory.createForClass(AgentType);

// Indexes
AgentTypeSchema.index({ name: 1 });
AgentTypeSchema.index({ isActive: 1 });

// JSON transform
AgentTypeSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
