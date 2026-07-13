import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type GovernanceSourceEventDocument = HydratedDocument<GovernanceSourceEvent>;
export type GovernanceSourceEventType = 'source.created' | 'version.captured' | 'version.technical_status_changed' | 'version.submitted_for_review' | 'version.returned_to_editing' | 'version.approved' | 'version.rejected' | 'version.published' | 'version.superseded' | 'validity.updated' | 'artifact.ready' | 'artifact.unavailable' | 'workspace.binding.created';
@Schema({ timestamps: true, collection: 'governance_source_events' })
export class GovernanceSourceEvent {
  @Prop({ type: Types.ObjectId, ref: 'GovernanceProgram', required: true, index: true }) programId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'GovernanceSource', required: true, index: true }) sourceId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, ref: 'GovernanceSourceVersion', index: true }) versionId?: Types.ObjectId;
  @Prop({ required: true, index: true }) eventType!: GovernanceSourceEventType;
  @Prop({ type: Types.ObjectId, ref: 'User' }) actorId?: Types.ObjectId;
  @Prop({ maxlength: 320 }) actorEmail?: string;
  @Prop({ required: true, index: true }) occurredAt!: Date;
  @Prop({ maxlength: 2000 }) reason?: string;
  @Prop({ type: Object }) before?: Record<string, unknown>;
  @Prop({ type: Object }) after?: Record<string, unknown>;
  @Prop({ type: Object, default: {} }) metadata!: Record<string, unknown>;
  @Prop({ index: true }) correlationId?: string;
  @Prop() causationId?: string;
}
export const GovernanceSourceEventSchema = SchemaFactory.createForClass(GovernanceSourceEvent);
GovernanceSourceEventSchema.set('toJSON', {
  virtuals: true,
  transform: (_document, returned: any) => {
    returned.id = String(returned._id);
    delete returned._id;
    delete returned.__v;
  },
});
GovernanceSourceEventSchema.index({ sourceId: 1, occurredAt: -1 });
GovernanceSourceEventSchema.index({ versionId: 1, occurredAt: -1 });
GovernanceSourceEventSchema.index({ programId: 1, eventType: 1, occurredAt: -1 });
