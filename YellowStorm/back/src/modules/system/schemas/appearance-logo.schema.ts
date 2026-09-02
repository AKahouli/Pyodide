import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type AppearanceLogoDocument = HydratedDocument<AppearanceLogo>;

@Schema({ timestamps: true, collection: 'appearance_logos' })
export class AppearanceLogo {
  @Prop({ required: true, trim: true, maxlength: 80 })
  name!: string;

  @Prop({ required: true })
  contentType!: string;

  @Prop({ required: true })
  width!: number;

  @Prop({ required: true })
  height!: number;

  @Prop({ type: Buffer, required: true, select: false })
  data!: Buffer;

  createdAt!: Date;
  updatedAt!: Date;
}

export const AppearanceLogoSchema = SchemaFactory.createForClass(AppearanceLogo);

AppearanceLogoSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    delete ret.data;
    return ret;
  },
});
