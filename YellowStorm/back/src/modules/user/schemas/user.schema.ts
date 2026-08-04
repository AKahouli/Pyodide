import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

@Schema({ _id: false })
export class UserProfile {
  @Prop({ trim: true, maxlength: 100 })
  firstName?: string;

  @Prop({ trim: true, maxlength: 100 })
  lastName?: string;

  @Prop({ trim: true, maxlength: 200 })
  company?: string;

  @Prop({ trim: true, maxlength: 200, default: '' })
  role?: string;

  @Prop({ trim: true, maxlength: 1000, default: '' })
  description?: string;
}

@Schema({ _id: false })
export class UserAppearance {
  @Prop({
    type: String,
    enum: ['default', 'yellow', 'orange', 'blue'],
    default: 'default',
  })
  colorTheme!: 'default' | 'yellow' | 'orange' | 'blue';

  @Prop({ type: String, default: 'en' })
  language!: string;
}

@Schema({ _id: false })
export class UserConsents {
  @Prop({ default: false })
  privacyPolicy!: boolean;

  @Prop()
  privacyPolicyAcceptedAt?: Date;

  @Prop({ default: false })
  dataSharing!: boolean;

  @Prop()
  dataSharingAcceptedAt?: Date;
}

export enum UserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
}

@Schema({
  timestamps: true,
  collection: 'users',
})
export class User extends Document {
  @Prop({
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true,
  })
  email!: string;

  @Prop({ required: true })
  passwordHash!: string;

  // Email verification
  @Prop({ default: false })
  emailVerified!: boolean;

  @Prop({ select: false })
  emailVerificationToken?: string;

  @Prop()
  emailVerificationExpiry?: Date;

  // Password reset
  @Prop({ select: false })
  passwordResetToken?: string;

  @Prop()
  passwordResetExpiry?: Date;

  // Profile
  @Prop({ type: UserProfile, default: {} })
  profile!: UserProfile;

  // Appearance preferences
  @Prop({ type: UserAppearance, default: { colorTheme: 'default', language: 'en' } })
  appearance!: UserAppearance;

  // Consents
  @Prop({ type: UserConsents, default: {} })
  consents!: UserConsents;

  @Prop({ default: false })
  profileComplete!: boolean;

  // Microsoft integration
  @Prop({ sparse: true, index: true })
  microsoftAccountId?: string;

  // Plan/Subscription
  @Prop({ type: Types.ObjectId, ref: 'Plan', index: true })
  planId?: Types.ObjectId;

  @Prop({ type: String, maxlength: 50 })
  planSlug?: string;

  @Prop()
  planStartedAt?: Date;

  // RBAC
  @Prop({ type: [Types.ObjectId], ref: 'Role', default: [] })
  roles!: Types.ObjectId[];

  @Prop({ type: Number, default: 1 })
  permissionsVersion!: number;

  // Status
  @Prop({
    type: String,
    enum: UserStatus,
    default: UserStatus.ACTIVE,
  })
  status!: UserStatus;

  // Timestamps (auto-generated)
  createdAt!: Date;
  updatedAt!: Date;

  @Prop()
  lastLoginAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Indexes (note: email and microsoftAccountId already have index: true on @Prop)
UserSchema.index({ status: 1 });
UserSchema.index({ createdAt: -1 });

// Virtual for full name
UserSchema.virtual('fullName').get(function (this: UserDocument) {
  if (this.profile?.firstName && this.profile?.lastName) {
    return `${this.profile.firstName} ${this.profile.lastName}`;
  }
  return this.profile?.firstName || this.profile?.lastName || undefined;
});

// Ensure virtuals are included in JSON output
UserSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    delete ret.passwordHash;
    delete ret.emailVerificationToken;
    delete ret.passwordResetToken;
    return ret;
  },
});
