import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type HealthHistoryDocument = HealthHistory & Document;

@Schema({ collection: 'health_history' })
export class HealthCheckDetailRecord {
  @Prop({ required: true, enum: ['up', 'down', 'degraded'] })
  status!: 'up' | 'down' | 'degraded';

  @Prop()
  responseTime?: number;

  @Prop()
  message?: string;

  @Prop({ required: true })
  lastChecked!: string;
}

@Schema({
  collection: 'health_history',
  timestamps: { createdAt: 'recordedAt', updatedAt: false },
})
export class HealthHistory {
  @Prop({ required: true, enum: ['healthy', 'unhealthy', 'degraded'] })
  status!: 'healthy' | 'unhealthy' | 'degraded';

  @Prop({ required: true })
  timestamp!: string;

  @Prop({ required: true })
  version!: string;

  @Prop({ required: true })
  uptime!: number;

  @Prop({ type: Object, required: true })
  checks!: Record<string, HealthCheckDetailRecord>;

  @Prop({ type: Date, required: true, index: true })
  recordedAt!: Date;

  @Prop({
    type: Date,
    required: true,
    index: true,
    // TTL index - documents automatically deleted after expireAt
    expires: 0,
  })
  expireAt!: Date;
}

export const HealthHistorySchema = SchemaFactory.createForClass(HealthHistory);

// Compound index for efficient time-range queries
HealthHistorySchema.index({ recordedAt: -1 });
HealthHistorySchema.index({ status: 1, recordedAt: -1 });
