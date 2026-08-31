import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type AppRuntimeToolCallDocument = HydratedDocument<AppRuntimeToolCall>;

export type AppRuntimeToolCallStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed';

/**
 * Idempotency record for a single runtime tool invocation. `toolCallId` is the
 * idempotency key: the same id must never execute a mutating tool twice.
 *
 * Nothing writes to this collection yet — the browser runtime adapter does,
 * once the `/app-runtime` gateway exists.
 */
@Schema({ timestamps: true, collection: 'app_runtime_tool_calls' })
export class AppRuntimeToolCall {
  @Prop({ type: String, required: true, unique: true })
  toolCallId!: string;

  @Prop({ type: String, required: true, index: true })
  bindingId!: string;

  @Prop({ type: String, required: true })
  workspaceId!: string;

  @Prop({ type: String, required: true })
  tool!: string;

  @Prop({ type: String, required: true })
  argumentsHash!: string;

  @Prop({ type: String, default: null })
  baseRevisionId?: string | null;

  @Prop({
    type: String,
    required: true,
    enum: ['pending', 'running', 'succeeded', 'failed'],
    default: 'pending',
  })
  status!: AppRuntimeToolCallStatus;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  result?: Record<string, unknown> | null;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  error?: Record<string, unknown> | null;

  @Prop({ type: String, default: null })
  resultingRevisionId?: string | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const AppRuntimeToolCallSchema = SchemaFactory.createForClass(AppRuntimeToolCall);

AppRuntimeToolCallSchema.index({ bindingId: 1, createdAt: -1 });
