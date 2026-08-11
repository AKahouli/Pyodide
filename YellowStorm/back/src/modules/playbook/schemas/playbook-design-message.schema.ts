import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type PlaybookDesignMessageDocument = HydratedDocument<PlaybookDesignMessage>;

@Schema({ _id: false })
export class PlaybookSnapshot {
  @Prop({ type: [{ type: Object }], default: [] })
  tasks!: any[];

  @Prop({ type: [{ type: Object }], default: [] })
  edges!: any[];
}

export const PlaybookSnapshotSchema = SchemaFactory.createForClass(PlaybookSnapshot);

@Schema({ timestamps: true, collection: 'playbook_design_messages' })
export class PlaybookDesignMessage extends Document {
  @Prop({ type: Types.ObjectId, ref: 'Playbook', required: true, index: true })
  playbookId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: String, maxlength: 20000, default: '' })
  userQuery!: string;

  @Prop({ type: String, default: '' })
  aiSummary!: string;

  @Prop({ type: PlaybookSnapshotSchema, required: true })
  snapshotBefore!: PlaybookSnapshot;

  @Prop({ type: String, enum: ['completed', 'failed', 'reverted'], default: 'completed' })
  status!: string;

  @Prop({ type: Types.ObjectId, ref: 'PlaybookDesignMessage', default: null })
  revertedFromMessageId!: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  error!: string | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const PlaybookDesignMessageSchema = SchemaFactory.createForClass(PlaybookDesignMessage);

PlaybookDesignMessageSchema.index({ playbookId: 1, createdAt: -1 });

PlaybookDesignMessageSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
