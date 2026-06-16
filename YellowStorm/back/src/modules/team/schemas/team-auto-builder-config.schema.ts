import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';

export type TeamAutoBuilderConfigDocument = HydratedDocument<TeamAutoBuilderConfig>;

/** Singleton config for the team auto-builder (AI team generation). */
@Schema({
  timestamps: true,
  collection: 'team_auto_builder_config',
})
export class TeamAutoBuilderConfig extends Document {
  @Prop({ required: true })
  modelId!: string;

  @Prop({ required: true, maxlength: 10000 })
  systemPrompt!: string;

  @Prop({ type: Number, default: 0.7, min: 0, max: 2 })
  temperature!: number;

  @Prop({ default: false })
  isEnabled!: boolean;

  createdAt!: Date;
  updatedAt!: Date;
}

export const TeamAutoBuilderConfigSchema = SchemaFactory.createForClass(TeamAutoBuilderConfig);

TeamAutoBuilderConfigSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
