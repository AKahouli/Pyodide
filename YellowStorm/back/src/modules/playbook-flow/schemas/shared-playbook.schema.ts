import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type SharedPlaybookDocument = HydratedDocument<SharedPlaybook>;

/** Grants access to an owned playbook without changing its owner. */
@Schema({ timestamps: true, collection: 'shared_playbooks' })
export class SharedPlaybook extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Flow', required: true, index: true })
  playbookId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  sharedBy!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  sharedWith!: Types.ObjectId;

  @Prop({ type: String, enum: ['read', 'write'], default: 'read', required: true })
  permission!: 'read' | 'write';

  createdAt!: Date;
  updatedAt!: Date;
}

export const SharedPlaybookSchema = SchemaFactory.createForClass(SharedPlaybook);

SharedPlaybookSchema.index({ playbookId: 1, sharedWith: 1 }, { unique: true });
SharedPlaybookSchema.index({ sharedWith: 1, createdAt: -1 });
SharedPlaybookSchema.index({ sharedBy: 1 });

SharedPlaybookSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc: unknown, ret: any) => {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
