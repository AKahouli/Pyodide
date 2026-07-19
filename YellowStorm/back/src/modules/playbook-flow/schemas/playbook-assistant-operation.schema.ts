import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type PlaybookAssistantOperationDocument = HydratedDocument<PlaybookAssistantOperation>;

@Schema({ timestamps: true })
export class PlaybookAssistantOperation {
  @Prop({ required: true, type: String, unique: true, index: true })
  operationId!: string;

  @Prop({ required: true, type: String, index: true })
  playbookId!: string;

  @Prop({ required: true, type: String, index: true })
  ownerId!: string;

  @Prop({ required: true, type: String, enum: ['designer', 'mcp', 'advisor'], default: 'designer' })
  origin!: 'designer' | 'mcp' | 'advisor';

  @Prop({ required: true, type: String, enum: ['canonical', 'advisor_preview'], default: 'canonical' })
  target!: 'canonical' | 'advisor_preview';

  @Prop({ required: true, type: String, enum: ['current_playbook', 'new_playbook'], default: 'current_playbook' })
  applyTarget!: 'current_playbook' | 'new_playbook';

  @Prop({ required: true, type: String, enum: ['pending', 'applying', 'applied', 'discarded', 'reverted'], default: 'pending' })
  disposition!: 'pending' | 'applying' | 'applied' | 'discarded' | 'reverted';

  @Prop({ required: true, type: String, enum: ['queued', 'running', 'completed', 'failed', 'cancelled'], default: 'queued', index: true })
  status!: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

  @Prop({ required: true, type: Number, min: 0 })
  baseDefinitionRevision!: number;

  @Prop({ required: true, type: Number, min: 0, default: 0 })
  lastSequence!: number;

  @Prop({ required: true, type: [Object], default: [] })
  events!: Record<string, unknown>[];

  @Prop({ required: true, type: Number, min: 0, default: 0 })
  eventBytes!: number;

  @Prop({ required: true, type: String, index: true })
  workerId!: string;

  @Prop({ required: false, type: Date, default: null, index: true })
  leaseExpiresAt?: Date | null;

  @Prop({ required: false, type: Date, default: null })
  terminalAt?: Date | null;

  @Prop({ required: false, type: Number, default: null })
  committedRevision?: number | null;

  @Prop({ required: false, type: Date, default: null })
  committedAt?: Date | null;

  @Prop({ required: false, type: Number, default: null })
  revertedRevision?: number | null;

  @Prop({ required: false, type: Date, default: null })
  revertedAt?: Date | null;

  @Prop({ required: false, type: String, default: null })
  createdPlaybookId?: string | null;

  @Prop({ required: true, type: Date })
  expiresAt!: Date;

  createdAt?: Date;
  updatedAt?: Date;
}

export const PlaybookAssistantOperationSchema = SchemaFactory.createForClass(PlaybookAssistantOperation);

PlaybookAssistantOperationSchema.index({ ownerId: 1, playbookId: 1, createdAt: -1 });
PlaybookAssistantOperationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
