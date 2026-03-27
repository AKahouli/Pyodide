import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type ToolDocument = HydratedDocument<Tool>;

export enum ToolAttributeType {
  STRING = 'string',
  NUMBER = 'number',
  BOOLEAN = 'boolean',
  ENUM = 'enum',
}

@Schema({ _id: true })
export class ToolAttribute {
  @Prop({ required: true })
  name!: string;

  @Prop({ required: true, enum: ToolAttributeType })
  type!: ToolAttributeType;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  value!: string | number | boolean;

  @Prop({ type: [String] })
  options?: string[];
}

export const ToolAttributeSchema = SchemaFactory.createForClass(ToolAttribute);

@Schema({
  timestamps: true,
  collection: 'tools',
})
export class Tool extends Document {
  @Prop({ required: true, unique: true, index: true })
  name!: string;

  @Prop({ default: '' })
  description!: string;

  @Prop({ type: [String], default: [] })
  defaultAgentTypes!: string[];

  @Prop({ type: [ToolAttributeSchema], default: [] })
  attributes!: ToolAttribute[];

  @Prop({ default: true })
  isActive!: boolean;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ToolSchema = SchemaFactory.createForClass(Tool);

// Indexes
ToolSchema.index({ name: 1 });
ToolSchema.index({ isActive: 1 });
ToolSchema.index({ defaultAgentTypes: 1 });

// JSON transform
ToolSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
