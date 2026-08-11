import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type PlaybookMailEventLedgerDocument = HydratedDocument<PlaybookMailEventLedger>;

@Schema({ _id: false })
export class MailEventParticipantDocument {
  @Prop({ type: String, default: null })
  name!: string | null;

  @Prop({ type: String, required: true })
  address!: string;
}

export const MailEventParticipantDocumentSchema = SchemaFactory.createForClass(MailEventParticipantDocument);

@Schema({ _id: false })
export class MailEventWorkspaceImportDocument {
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

export const MailEventWorkspaceImportDocumentSchema = SchemaFactory.createForClass(MailEventWorkspaceImportDocument);

@Schema({ _id: false })
export class MailEventAttachmentDocument {
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

  @Prop({ type: MailEventWorkspaceImportDocumentSchema, default: null })
  workspaceImport!: MailEventWorkspaceImportDocument | null;
}

export const MailEventAttachmentDocumentSchema = SchemaFactory.createForClass(MailEventAttachmentDocument);

@Schema({ collection: 'playbook_mail_event_ledger', timestamps: false })
export class PlaybookMailEventLedger {
  @Prop({ type: String, required: true, unique: true })
  id!: string;

  @Prop({ type: Types.ObjectId, ref: 'Playbook', required: true, index: true })
  playbookId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  dedupeKey!: string;

  @Prop({ type: String, enum: ['received', 'normalized', 'matched', 'handed_off', 'deduplicated', 'ignored', 'errored'], default: 'received', index: true })
  status!: 'received' | 'normalized' | 'matched' | 'handed_off' | 'deduplicated' | 'ignored' | 'errored';

  @Prop({ type: String, default: 'm365' })
  provider!: 'm365';

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

  @Prop({ type: MailEventParticipantDocumentSchema, required: true })
  from!: MailEventParticipantDocument;

  @Prop({ type: [MailEventParticipantDocumentSchema], default: [] })
  to!: MailEventParticipantDocument[];

  @Prop({ type: [MailEventParticipantDocumentSchema], default: [] })
  cc!: MailEventParticipantDocument[];

  @Prop({ type: Boolean, default: false })
  hasAttachments!: boolean;

  @Prop({ type: [MailEventAttachmentDocumentSchema], default: [] })
  attachments!: MailEventAttachmentDocument[];

  @Prop({ type: String, default: null })
  error!: string | null;

  @Prop({ type: String, default: null, index: true })
  executionId!: string | null;

  @Prop({ type: Date, required: true, index: true })
  createdAt!: Date;
}

export const PlaybookMailEventLedgerSchema = SchemaFactory.createForClass(PlaybookMailEventLedger);
PlaybookMailEventLedgerSchema.index({ playbookId: 1, dedupeKey: 1 }, { unique: true, name: 'uniq_playbook_mail_dedupe' });
