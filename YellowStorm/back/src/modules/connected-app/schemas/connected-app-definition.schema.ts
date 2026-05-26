import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';

export type ConnectedAppDefinitionDocument = HydratedDocument<ConnectedAppDefinition>;

export enum ConnectedAppAuthType {
  OAUTH2 = 'oauth2',
  API_KEY = 'api_key',
}

@Schema({
  timestamps: true,
  collection: 'connected_app_definitions',
})
export class ConnectedAppDefinition extends Document {
  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true,
    maxlength: 50,
  })
  appKey!: string;

  @Prop({
    type: String,
    enum: Object.values(ConnectedAppAuthType),
    default: ConnectedAppAuthType.OAUTH2,
  })
  authType!: ConnectedAppAuthType;

  @Prop({ required: true, trim: true, maxlength: 100 })
  displayName!: string;

  @Prop({ trim: true, maxlength: 500 })
  description?: string;

  @Prop({ trim: true, maxlength: 50 })
  iconKey?: string;

  @Prop()
  authorizationUrl?: string;

  @Prop()
  tokenUrl?: string;

  @Prop()
  revokeUrl?: string;

  @Prop()
  clientId?: string;

  @Prop()
  clientSecret?: string;

  @Prop()
  tenantId?: string;

  @Prop({ type: [String], default: [] })
  scopes!: string[];

  @Prop({ type: Boolean, default: true })
  pkceEnabled!: boolean;

  @Prop()
  apiKey?: string;

  @Prop({ type: Boolean, default: true })
  enabled!: boolean;

  @Prop({ type: Number, default: 0 })
  sortOrder!: number;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ConnectedAppDefinitionSchema = SchemaFactory.createForClass(ConnectedAppDefinition);

ConnectedAppDefinitionSchema.index({ enabled: 1, sortOrder: 1 });

ConnectedAppDefinitionSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    if (ret.clientId) ret.clientId = '****';
    if (ret.clientSecret) ret.clientSecret = '****';
    if (ret.tenantId) ret.tenantId = '****';
    if (ret.apiKey) ret.apiKey = '****';
    return ret;
  },
});
