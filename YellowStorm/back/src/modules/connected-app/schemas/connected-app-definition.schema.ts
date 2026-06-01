import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';

export type ConnectedAppDefinitionDocument = HydratedDocument<ConnectedAppDefinition>;

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

  @Prop({ required: true, trim: true, maxlength: 100 })
  displayName!: string;

  @Prop({ trim: true, maxlength: 500 })
  description?: string;

  @Prop({ trim: true, maxlength: 50 })
  iconKey?: string;

  @Prop({ required: true })
  authorizationUrl!: string;

  @Prop({ required: true })
  tokenUrl!: string;

  @Prop()
  revokeUrl?: string;

  @Prop({ required: true })
  clientId!: string;

  @Prop({ required: true })
  clientSecret!: string;

  @Prop()
  tenantId?: string;

  @Prop({ type: [String], required: true })
  scopes!: string[];

  @Prop({ type: Boolean, default: true })
  pkceEnabled!: boolean;

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
    return ret;
  },
});
