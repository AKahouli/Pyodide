import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type WorkyElectricCursorDocument = HydratedDocument<WorkyElectricCursor>;

@Schema({ timestamps: true, collection: 'worky_electric_cursors' })
export class WorkyElectricCursor {
  /** Logical shape name, e.g. 'tasks' | 'task_results' | 'messages' | 'interactions'. */
  @Prop({ type: String, required: true, unique: true })
  shape!: string;

  /** Electric shape handle for resume; null until the first batch. */
  @Prop({ type: String, default: null })
  handle?: string | null;

  /** Electric shape log offset for resume; null until the first batch. */
  @Prop({ type: String, default: null })
  offset?: string | null;
}

export const WorkyElectricCursorSchema = SchemaFactory.createForClass(WorkyElectricCursor);
