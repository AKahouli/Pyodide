import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type GovernanceProgramDocument = HydratedDocument<GovernanceProgram>;

@Schema({ timestamps: true, collection: 'governance_programs' })
export class GovernanceProgram extends Document {
  @Prop({ required: true, trim: true, maxlength: 160 })
  name!: string;

  @Prop({ trim: true, maxlength: 2000 })
  description?: string;

  @Prop({ trim: true, maxlength: 100 })
  domain?: string;

  @Prop({ default: 'fr', maxlength: 10 })
  defaultLanguage!: string;

  @Prop({ type: String, enum: ['draft', 'published', 'archived'], default: 'draft', index: true })
  status!: 'draft' | 'published' | 'archived';

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  ownerUserId!: Types.ObjectId;

  @Prop({ type: Object, default: {} })
  metadata!: Record<string, unknown>;

  createdAt!: Date;
  updatedAt!: Date;
}

export const GovernanceProgramSchema = SchemaFactory.createForClass(GovernanceProgram);

GovernanceProgramSchema.index({ ownerUserId: 1, createdAt: -1 });
GovernanceProgramSchema.index({ status: 1, updatedAt: -1 });

GovernanceProgramSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id?.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
