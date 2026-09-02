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
  transform: (_doc, ret) => {
    const json = ret as unknown as Record<string, unknown>;
    json.id = String(json._id);
    delete json._id;
    delete json.__v;
    delete json.data;
    return json;
  },
});
