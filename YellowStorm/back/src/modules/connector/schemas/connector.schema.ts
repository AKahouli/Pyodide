import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ConnectorDocument = HydratedDocument<Connector>;

export enum ConnectorActionSafety {
  READ = 'read',
  WRITE = 'write',
  DELETE = 'delete',
}

export enum ConnectorAuthType {
  OAUTH2 = 'oauth2',
  API_KEY = 'api_key',
  TOKEN = 'token',
  BASIC = 'basic',
  NONE = 'none',
}

export enum McpTransportType {
  STDIO = 'stdio',
  SSE = 'sse',
  STREAMABLE_HTTP = 'streamable_http',
}

@Schema({ _id: true })
export class ConnectorAction {
  @Prop({ required: true, trim: true, maxlength: 128 })
  key!: string;

  @Prop({ required: true, trim: true, maxlength: 128 })
  label!: string;

  @Prop({ default: '', maxlength: 1024 })
  description!: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  parameterSchema!: Record<string, unknown>;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  outputSchema!: Record<string, unknown>;

  @Prop({ required: true, enum: ConnectorActionSafety, default: ConnectorActionSafety.READ })
  safety!: ConnectorActionSafety;

  @Prop({ default: false })
  supportsBatch!: boolean;

  @Prop({ default: false })
  supportsIteration!: boolean;

  @Prop({ default: true })
  isEnabled!: boolean;
}

export const ConnectorActionSchema = SchemaFactory.createForClass(ConnectorAction);

@Schema({
  timestamps: true,
  collection: 'connectors',
})
export class Connector extends Document {
  @Prop({ required: true, trim: true, minlength: 1, maxlength: 64, index: true })
  slug!: string;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 128 })
  name!: string;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 1024 })
  description!: string;

  @Prop({ default: '', maxlength: 64 })
  icon!: string;

  @Prop({ default: '', maxlength: 64 })
  color!: string;

  @Prop({ required: true, enum: ConnectorAuthType, default: ConnectorAuthType.NONE })
  authType!: ConnectorAuthType;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  authConfigSchema!: Record<string, unknown>;

  @Prop({ required: true, enum: McpTransportType, default: McpTransportType.STREAMABLE_HTTP })
  mcpTransportType!: McpTransportType;

  @Prop({ required: true, trim: true, maxlength: 1024 })
  mcpServerUrl!: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  mcpServerConfig!: Record<string, unknown>;

  @Prop({ type: [ConnectorActionSchema], default: [] })
  actions!: ConnectorAction[];

  @Prop({ type: [Types.ObjectId], ref: 'Skill', default: [] })
  referencedSkillIds!: Types.ObjectId[];

  @Prop({ default: true, index: true })
  isActive!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ConnectorSchema = SchemaFactory.createForClass(Connector);

ConnectorSchema.index({ slug: 1, createdBy: 1 }, { unique: true });
ConnectorSchema.index({ isActive: 1, createdBy: 1 });

ConnectorSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
