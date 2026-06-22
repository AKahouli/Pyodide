import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AdminConnectorOAuthStateDocument = HydratedDocument<AdminConnectorOAuthState>;

@Schema({
  timestamps: true,
  collection: 'admin_connector_oauth_states',
})
export class AdminConnectorOAuthState {
  @Prop({ required: true, unique: true, index: true })
  state!: string;

  @Prop({ required: true, trim: true, maxlength: 64 })
  appKey!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop()
  codeVerifier?: string;

  @Prop({ required: true })
  expiresAt!: Date;
}

export const AdminConnectorOAuthStateSchema = SchemaFactory.createForClass(AdminConnectorOAuthState);

AdminConnectorOAuthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
