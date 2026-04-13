import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type UserProviderLinkDocument = HydratedDocument<UserProviderLink>;

@Schema({
  timestamps: true,
  collection: 'user_provider_links',
})
export class UserProviderLink extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true })
  providerKey!: string;

  @Prop({ required: true })
  providerUserId!: string;

  @Prop({ required: true, lowercase: true })
  providerEmail!: string;

  @Prop({ required: true, default: () => new Date() })
  linkedAt!: Date;

  // Timestamps (auto-generated)
  createdAt!: Date;
  updatedAt!: Date;
}

export const UserProviderLinkSchema = SchemaFactory.createForClass(UserProviderLink);

// Compound unique index: one provider account can only link to one user
UserProviderLinkSchema.index({ providerKey: 1, providerUserId: 1 }, { unique: true });

// Transform for JSON output
UserProviderLinkSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
