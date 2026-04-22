import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type PlaybookNodeTemplateDocument = HydratedDocument<PlaybookNodeTemplate>;

@Schema({ timestamps: true, collection: 'playbook_node_templates' })
export class PlaybookNodeTemplate extends Document {
  @Prop({ required: true, unique: true, index: true, trim: true, maxlength: 120 })
  key!: string;

  @Prop({ required: true, unique: true, index: true, trim: true, maxlength: 120 })
  type!: string;

  @Prop({ required: true, trim: true, maxlength: 160 })
  title!: string;

  @Prop({ trim: true, maxlength: 600 })
  description?: string;

  @Prop({ trim: true, maxlength: 80 })
  icon?: string;

  @Prop({ trim: true, maxlength: 40 })
  color?: string;

  @Prop({ required: true, trim: true, maxlength: 80, index: true })
  category!: string;

  @Prop({
    type: [
      {
        id: { type: String, required: true, trim: true },
        name: { type: String, required: true, trim: true },
        artifactKind: { type: String, required: true, trim: true },
        required: { type: Boolean, required: true },
        description: { type: String, trim: true },
      },
    ],
    default: [],
  })
  inputPorts!: Array<{
    id: string;
    name: string;
    artifactKind: string;
    required: boolean;
    description?: string;
  }>;

  @Prop({
    type: [
      {
        id: { type: String, required: true, trim: true },
        name: { type: String, required: true, trim: true },
        artifactKind: { type: String, required: true, trim: true },
        description: { type: String, trim: true },
      },
    ],
    default: [],
  })
  outputPorts!: Array<{
    id: string;
    name: string;
    artifactKind: string;
    description?: string;
  }>;

  @Prop({ type: String, default: '' })
  promptTemplate!: string;

  @Prop({ type: String, default: null, trim: true })
  recommendedAgentTypeSlug!: string | null;

  @Prop({ type: [String], default: [] })
  requiredToolNames!: string[];

  @Prop({ type: String, default: 'agent', trim: true, maxlength: 40 })
  executionMode!: string;

  @Prop({ type: String, default: null, trim: true })
  assignedAgentId!: string | null;

  @Prop({ type: String, default: null, trim: true })
  selectedAction!: string | null;

  @Prop({ type: Boolean, default: true, index: true })
  enabled!: boolean;

  @Prop({ type: Number, default: 1, min: 1 })
  version!: number;

  @Prop({ type: Boolean, default: false })
  isBuiltIn!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  updatedBy!: Types.ObjectId | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const PlaybookNodeTemplateSchema = SchemaFactory.createForClass(PlaybookNodeTemplate);

PlaybookNodeTemplateSchema.index({ category: 1, enabled: 1 });
PlaybookNodeTemplateSchema.index({ enabled: 1, title: 1 });

PlaybookNodeTemplateSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
