import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';

export type LogDocument = HydratedDocument<Log>;

export enum LogLevelEnum {
  ERROR = 'ERROR',
  WARN = 'WARN',
  INFO = 'INFO',
  DEBUG = 'DEBUG',
  VERBOSE = 'VERBOSE',
}

/**
 * Log Schema
 * Stores application logs in MongoDB for persistence and analysis
 */
@Schema({
  timestamps: { createdAt: true, updatedAt: false },
  collection: 'logs',
})
export class Log extends Document {
  @Prop({ required: true, index: true })
  timestamp!: string;

  @Prop({
    required: true,
    enum: Object.values(LogLevelEnum),
    index: true,
  })
  level!: string;

  @Prop({ index: true })
  context?: string;

  @Prop({ required: true })
  message!: string;

  @Prop({ type: Object })
  data?: Record<string, unknown>;

  @Prop()
  traceId?: string;

  @Prop({ index: true })
  requestId?: string;

  @Prop()
  hostname?: string;

  @Prop()
  nodeEnv?: string;

  createdAt!: Date;
}

export const LogSchema = SchemaFactory.createForClass(Log);

// Compound index for querying by level and time
LogSchema.index({ level: 1, createdAt: -1 });

// Compound index for querying by context and time
LogSchema.index({ context: 1, createdAt: -1 });

// TTL index - auto-delete after configured days (default 30 days)
// This is created with a default value; the actual TTL can be configured via environment
LogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
