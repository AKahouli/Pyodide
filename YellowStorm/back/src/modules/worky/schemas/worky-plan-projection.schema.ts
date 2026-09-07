import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WorkyPlanProjectionDocument = HydratedDocument<WorkyPlanProjection>;

@Schema({ timestamps: true, collection: 'worky_plan_projections' })
export class WorkyPlanProjection {
  /** The worky stream this plan belongs to (unique — one plan per stream/session). */
  @Prop({ type: Types.ObjectId, ref: 'WorkyStream', required: true, unique: true, index: true })
  streamId!: Types.ObjectId;

  @Prop({ type: String, default: '' })
  title!: string;

  @Prop({ type: String, default: '' })
  goal!: string;

  /** Raw manager plan status string (e.g. 'completed'); not enum-constrained on purpose. */
  @Prop({ type: String, default: '' })
  status!: string;

  /** Session fields arrive through an independent Electric shape. */
  @Prop({ type: String, default: null })
  sessionStatus!: string | null;

  @Prop({ type: String, default: null })
  activeInterruptId!: string | null;
}

export const WorkyPlanProjectionSchema = SchemaFactory.createForClass(WorkyPlanProjection);
