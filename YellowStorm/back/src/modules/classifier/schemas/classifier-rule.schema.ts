import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type ClassifierRuleDocument = HydratedDocument<ClassifierRule>;

export enum ClassifierRuleScope {
  GLOBAL = 'global',
  LOCAL = 'local',
}

@Schema({
  timestamps: true,
  collection: 'classifier_rules',
})
export class ClassifierRule extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: ClassifierRuleScope,
    required: true,
    index: true,
  })
  scope!: ClassifierRuleScope;

  @Prop({ type: Types.ObjectId, ref: 'Workspace', default: null, index: true })
  workspaceId!: Types.ObjectId | null;

  @Prop({ type: String, required: true, trim: true, minlength: 1, maxlength: 1000 })
  text!: string;

  @Prop({ type: Boolean, default: true, index: true })
  enabled!: boolean;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ClassifierRuleSchema = SchemaFactory.createForClass(ClassifierRule);

ClassifierRuleSchema.index({ userId: 1, scope: 1, workspaceId: 1, createdAt: -1 });

ClassifierRuleSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
