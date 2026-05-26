import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FlowMailEventLedgerDocument = HydratedDocument<FlowMailEventLedger>;

@Schema({ _id: false })
export class FlowMailParticipantDocument {
  @Prop({ type: String, default: null })
  name!: string | null;

  @Prop({ type: String, required: true })
  address!: string;
}

export const FlowMailParticipantDocumentSchema = SchemaFactory.createForClass(FlowMailParticipantDocument);

@Schema({ _id: false })
export class FlowMailAttachmentWorkspaceImportDocument {
  @Prop({ type: String, default: null })
  workspaceDocumentId!: string | null;

  @Prop({ type: String, required: true })
  filename!: string;

  @Prop({ type: String, default: null })
  finalFilename!: string | null;

  @Prop({ type: String, default: null })
  mimeType!: string | null;

  @Prop({ type: Number, default: null })
  size!: number | null;

  @Prop({ type: String, default: null })
  sourcePath!: string | null;

  @Prop({ type: Boolean, default: false })
  collisionResolved!: boolean;

  @Prop({ type: String, default: null })
  error!: string | null;
}

export const FlowMailAttachmentWorkspaceImportDocumentSchema =
  SchemaFactory.createForClass(FlowMailAttachmentWorkspaceImportDocument);

@Schema({ _id: false })
export class FlowMailAttachmentDocument {
  @Prop({ type: String, required: true })
  providerAttachmentId!: string;

  @Prop({ type: String, required: true })
  filename!: string;

  @Prop({ type: String, default: null })
  mimeType!: string | null;

  @Prop({ type: Number, default: null })
  size!: number | null;

  @Prop({ type: Boolean, default: false })
  isInline!: boolean;

  @Prop({ type: FlowMailAttachmentWorkspaceImportDocumentSchema, default: null })
  workspaceImport!: FlowMailAttachmentWorkspaceImportDocument | null;
}

export const FlowMailAttachmentDocumentSchema = SchemaFactory.createForClass(FlowMailAttachmentDocument);

@Schema({ collection: 'playbook_flow_mail_event_ledgers', timestamps: false })
export class FlowMailEventLedger {
  @Prop({ type: String, required: true })
  id!: string;

  @Prop({ type: String, required: true, index: true })
  flowId!: string;

  @Prop({ type: String, required: true })
  dedupeKey!: string;

  @Prop({
    type: String,
    enum: ['received', 'normalized', 'matched', 'handed_off', 'deduplicated', 'ignored', 'errored'],
    default: 'received',
    index: true,
  })
  status!: string;

  @Prop({ type: String, default: 'm365' })
  provider!: string;

  @Prop({ type: String, required: true })
  mailboxAppKey!: string;

  @Prop({ type: String, required: true })
  providerMessageId!: string;

  @Prop({ type: String, default: null })
  providerThreadId!: string | null;

  @Prop({ type: Date, required: true })
  receivedAt!: Date;

  @Prop({ type: Date, required: true })
  occurredAt!: Date;

  @Prop({ type: String, default: '' })
  subject!: string;

  @Prop({ type: String, default: '' })
  bodyText!: string;

  @Prop({ type: String, default: null })
  bodyHtml!: string | null;

  @Prop({ type: FlowMailParticipantDocumentSchema, required: true })
  from!: FlowMailParticipantDocument;

  @Prop({ type: [FlowMailParticipantDocumentSchema], default: [] })
  to!: FlowMailParticipantDocument[];

  @Prop({ type: [FlowMailParticipantDocumentSchema], default: [] })
  cc!: FlowMailParticipantDocument[];

  @Prop({ type: Boolean, default: false })
  hasAttachments!: boolean;

  @Prop({ type: [FlowMailAttachmentDocumentSchema], default: [] })
  attachments!: FlowMailAttachmentDocument[];

  @Prop({ type: String, default: null })
  error!: string | null;

  @Prop({ type: String, default: null, index: true })
  executionId!: string | null;

  @Prop({ type: Date, required: true, index: true })
  createdAt!: Date;
}

export const FlowMailEventLedgerSchema = SchemaFactory.createForClass(FlowMailEventLedger);

FlowMailEventLedgerSchema.index({ flowId: 1, dedupeKey: 1 }, { unique: true, name: 'uniq_flow_mail_dedupe' });
FlowMailEventLedgerSchema.index({ flowId: 1, createdAt: -1 });

FlowMailEventLedgerSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret.id ?? ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
