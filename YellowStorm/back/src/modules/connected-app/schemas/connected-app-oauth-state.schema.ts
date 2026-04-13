import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type ConnectedAppOAuthStateDocument = HydratedDocument<ConnectedAppOAuthState>;

@Schema({
  timestamps: true,
  collection: 'connected_app_oauth_states',
})
export class ConnectedAppOAuthState extends Document {
  @Prop({ required: true, unique: true, index: true })
  state!: string;

  @Prop({ required: true })
  appKey!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop()
  codeVerifier?: string;

  @Prop({ required: true })
  expiresAt!: Date;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ConnectedAppOAuthStateSchema = SchemaFactory.createForClass(ConnectedAppOAuthState);

ConnectedAppOAuthStateSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
