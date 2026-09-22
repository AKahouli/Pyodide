import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

export type AppRuntimeBindingDocument = HydratedDocument<AppRuntimeBinding>;

export type AppRuntimeBindingStatus =
  | 'created'
  | 'waiting_for_browser'
  | 'browser_active'
  | 'paused'
  | 'failed';

/**
 * Binds one App Builder conversation to a runtime workspace. For the MVP the
 * workspace is the Conversation V2 session itself, so `workspaceId ===
 * conversationSessionId`.
 *
 * The MCP bearer token is stored hashed: the plaintext is returned exactly
 * once, by the internal bind endpoint, and never reaches the browser.
 */
@Schema({ timestamps: true, collection: 'app_runtime_bindings' })
export class AppRuntimeBinding {
  @Prop({ type: String, required: true, unique: true })
  bindingId!: string;

  @Prop({ type: String, required: true, unique: true })
  workspaceId!: string;

  @Prop({ type: String, required: true, index: true })
  conversationSessionId!: string;

  @Prop({ type: String, required: true, index: true })
  userId!: string;

  @Prop({
    type: String,
    required: true,
    enum: ['created', 'waiting_for_browser', 'browser_active', 'paused', 'failed'],
    default: 'created',
  })
  status!: AppRuntimeBindingStatus;

  /** Ceph-backed revision id; new bindings start on the seeded starter. */
  @Prop({ type: String, required: true, default: 'starter_react_vite_v6' })
  latestRevisionId!: string;

  /** SHA-256 of the MCP bearer token. The plaintext is never persisted. */
  @Prop({ type: String, required: true })
  mcpTokenHash!: string;

  @Prop({ type: String, default: null })
  browserRuntimeId?: string | null;

  @Prop({ type: MongooseSchema.Types.Mixed, default: null })
  browserCapabilities?: Record<string, unknown> | null;

  @Prop({ type: Date, default: null })
  lastHeartbeatAt?: Date | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const AppRuntimeBindingSchema = SchemaFactory.createForClass(AppRuntimeBinding);

AppRuntimeBindingSchema.index({ mcpTokenHash: 1 });
