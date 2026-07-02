import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type UserGroupDocument = HydratedDocument<UserGroup>;

/**
 * A UserGroup is a named, private list of registered users owned by its
 * creator. It is a convenience for sharing: expanding a group yields the
 * member emails that the existing workspace-share flow consumes. Groups are
 * never shared between users.
 */
@Schema({
  timestamps: true,
  collection: 'user_groups',
})
export class UserGroup extends Document {
  @Prop({ required: true, trim: true, minlength: 2, maxlength: 100 })
  name!: string;

  @Prop({ default: '', maxlength: 2000 })
  description!: string;

  /** Users that belong to the group. */
  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  members!: Types.ObjectId[];

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const UserGroupSchema = SchemaFactory.createForClass(UserGroup);

// A user cannot have two groups with the same name.
UserGroupSchema.index({ name: 1, createdBy: 1 }, { unique: true });

UserGroupSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
