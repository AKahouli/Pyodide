import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';

export type ConnectorDocument = HydratedDocument<Connector>;

export enum ConnectorActionSafety {
  READ = 'read',
  WRITE = 'write',
  DELETE = 'delete',
}

export enum ConnectorActionResultKind {
  GENERIC = 'generic',
  WEB_SEARCH = 'web_search',
  WEB_FETCH = 'web_fetch',
  DOCUMENT_SEARCH = 'document_search',
  FILE_READ = 'file_read',
  DATABASE_QUERY = 'database_query',
}

export enum ConnectorCitationMode {
  NONE = 'none',
  SOURCE_ONLY = 'source_only',
  TEXT_FRAGMENT = 'text_fragment',
  DOCUMENT_EVIDENCE = 'document_evidence',
}

export enum ConnectorAuthType {
  OAUTH2 = 'oauth2',
  API_KEY = 'api_key',
  TOKEN = 'token',
  BASIC = 'basic',
  NONE = 'none',
}

export enum ConnectorAuthSourceType {
  CONNECTED_APP = 'connected_app',
  CREDENTIAL = 'credential',
  NONE = 'none',
  SERVER_CONFIG = 'server_config',
}

export enum RuntimeAuthStrategy {
  HTTP_HEADER_BEARER = 'http_header_bearer',
  CUSTOM_HEADERS = 'custom_headers',
  ENV_VARS = 'env_vars',
}

export enum McpTransportType {
  STDIO = 'stdio',
  SSE = 'sse',
  STREAMABLE_HTTP = 'streamable_http',
}

export enum DynamicHeaderSource {
  USER_ID = 'user_id',
  USER_EMAIL = 'user_email',
  USER_FIRST_NAME = 'user_first_name',
  USER_LAST_NAME = 'user_last_name',
  USER_FULL_NAME = 'user_full_name',
}

@Schema({ _id: false })
export class ConnectorDynamicHeader {
  @Prop({ required: true, trim: true, maxlength: 128 })
  headerName!: string;

  @Prop({ required: true, enum: DynamicHeaderSource })
  source!: DynamicHeaderSource;

  @Prop({ default: true })
  enabled!: boolean;
}

export const ConnectorDynamicHeaderSchema = SchemaFactory.createForClass(ConnectorDynamicHeader);

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

  @Prop({ enum: ConnectorActionResultKind, default: ConnectorActionResultKind.GENERIC })
  resultKind!: ConnectorActionResultKind;

  @Prop({ enum: ConnectorCitationMode, default: ConnectorCitationMode.NONE })
  citationMode!: ConnectorCitationMode;

  @Prop({ type: MongooseSchema.Types.Mixed, default: undefined })
  resultMapping?: Record<string, unknown>;
}

export const ConnectorActionSchema = SchemaFactory.createForClass(ConnectorAction);

@Schema({
  timestamps: true,
  collection: 'connectors',
})
export class Connector extends Document {
  @Prop({ required: true, trim: true, minlength: 1, maxlength: 64 })
  slug!: string;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 128 })
  name!: string;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 1024 })
  description!: string;

  @Prop({ default: '', maxlength: 64 })
  icon!: string;

  @Prop({ default: '', maxlength: 64 })
  color!: string;

  @Prop({ default: 'light', enum: ['light', 'dark'] })
  iconColor!: 'light' | 'dark';

  @Prop({ type: Types.ObjectId, ref: 'ConnectorCategory', default: null, index: true })
  categoryId?: Types.ObjectId | null;

  @Prop({ required: true, enum: ConnectorAuthType, default: ConnectorAuthType.NONE })
  authType!: ConnectorAuthType;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  authConfigSchema!: Record<string, unknown>;

  @Prop({ default: 'credential', enum: ConnectorAuthSourceType })
  authSourceType!: string;

  @Prop({ default: '', maxlength: 64, trim: true })
  connectedAppKey!: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  runtimeAuthConfig!: Record<string, unknown>;

  @Prop({ required: true, enum: McpTransportType, default: McpTransportType.STREAMABLE_HTTP })
  mcpTransportType!: McpTransportType;

  @Prop({ required: true, trim: true, maxlength: 1024 })
  mcpServerUrl!: string;

  @Prop({ type: MongooseSchema.Types.Mixed, default: {} })
  mcpServerConfig!: Record<string, unknown>;

  @Prop({ type: [ConnectorDynamicHeaderSchema], default: [] })
  dynamicHeaders!: ConnectorDynamicHeader[];

  @Prop({ type: [ConnectorActionSchema], default: [] })
  actions!: ConnectorAction[];

  @Prop({ type: [Types.ObjectId], ref: 'Skill', default: [] })
  referencedSkillIds!: Types.ObjectId[];

  @Prop({ default: true, index: true })
  isActive!: boolean;

  @Prop({ default: false, index: true })
  isSystem!: boolean;

  @Prop({ default: false, index: true })
  isHidden!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ConnectorSchema = SchemaFactory.createForClass(Connector);

ConnectorSchema.index({ slug: 1, createdBy: 1 }, { unique: true });
ConnectorSchema.index({ isActive: 1, createdBy: 1 });
ConnectorSchema.index({ slug: 1 }, { unique: true, partialFilterExpression: { isSystem: true } });

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
