import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument, Types } from 'mongoose';

export type WorkyExecutionReportDocument = HydratedDocument<WorkyExecutionReport>;

/**
 * Final report generated at the stream's terminal state. Always
 * generated; rich if budget remains, lightweight deterministic from
 * events/tasks/artifacts/traces otherwise (Part 4
 * `worky-report.service.ts`).
 */
@Schema({
  timestamps: true,
  collection: 'worky_execution_reports',
})
export class WorkyExecutionReport extends Document {
  @Prop({ type: Types.ObjectId, ref: 'WorkyStream', required: true, index: true })
  streamId!: Types.ObjectId;

  @Prop({ type: String, enum: ['summary', 'rich', 'lightweight'], required: true })
  type!: string;

  @Prop({ type: String, enum: ['generating', 'ready', 'failed'], required: true, default: 'generating' })
  status!: string;

  @Prop({ type: Types.ObjectId, ref: 'WorkspaceDocument', default: null })
  markdownArtifactId?: Types.ObjectId | null;

  @Prop({ type: String, default: '', maxlength: 5000 })
  summary!: string;

  @Prop({ type: String, default: '', maxlength: 200000 })
  markdown!: string;

  @Prop({ type: Object, default: {} })
  metadata!: Record<string, unknown>;

  @Prop({ type: Date, default: null })
  generatedAt?: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const WorkyExecutionReportSchema = SchemaFactory.createForClass(WorkyExecutionReport);

WorkyExecutionReportSchema.index({ streamId: 1, type: 1 });

WorkyExecutionReportSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
