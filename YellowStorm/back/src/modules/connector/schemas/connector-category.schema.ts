import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type ConnectorCategoryDocument = HydratedDocument<ConnectorCategory>;

@Schema({
  timestamps: true,
  collection: 'connector_categories',
})
export class ConnectorCategory extends Document {
  @Prop({ required: true, trim: true, minlength: 1, maxlength: 128 })
  name!: string;

  @Prop({ default: '', maxlength: 1024 })
  description!: string;

  /** Reserved built-in category that cannot be edited or deleted. Connectors in it are hidden from users. */
  @Prop({ default: false })
  isSystem!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  createdBy!: Types.ObjectId;

  createdAt!: Date;
  updatedAt!: Date;
}

export const ConnectorCategorySchema = SchemaFactory.createForClass(ConnectorCategory);

ConnectorCategorySchema.index({ name: 1, createdBy: 1 }, { unique: true });

ConnectorCategorySchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
