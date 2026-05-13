import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** Aligné avec la user story : quotidien, hebdomadaire, mensuel, avancé. */
export type ExecutionScheduleType = 'daily' | 'weekly' | 'monthly' | 'advanced';

@Schema({ _id: false })
export class DailySchedulePayload {
  /** Une ou plusieurs heures locales (HH:mm). */
  @Prop({ type: [String], default: [] })
  timesLocal!: string[];
}

export const DailySchedulePayloadSchema = SchemaFactory.createForClass(DailySchedulePayload);

@Schema({ _id: false })
export class WeeklySlot {
  /** 0 = dimanche … 6 = samedi */
  @Prop({ type: Number, min: 0, max: 6, required: true })
  weekday!: number;

  @Prop({ type: String, required: true })
  timeLocal!: string;
}

export const WeeklySlotSchema = SchemaFactory.createForClass(WeeklySlot);

@Schema({ _id: false })
export class WeeklySchedulePayload {
  @Prop({ type: [WeeklySlotSchema], default: [] })
  slots!: WeeklySlot[];
}

export const WeeklySchedulePayloadSchema = SchemaFactory.createForClass(WeeklySchedulePayload);

@Schema({ _id: false })
export class MonthlySlot {
  @Prop({ type: Number, min: 1, max: 12, default: null })
  monthOfYear!: number | null;
  /** 1–31, 0 = chaque jour du mois, ou -1 pour le dernier jour du mois */
  @Prop({ type: Number, required: true })
  dayOfMonth!: number;

  @Prop({ type: String, required: true })
  timeLocal!: string;
}

export const MonthlySlotSchema = SchemaFactory.createForClass(MonthlySlot);

@Schema({ _id: false })
export class MonthlySchedulePayload {
  @Prop({ type: [MonthlySlotSchema], default: [] })
  slots!: MonthlySlot[];
}

export const MonthlySchedulePayloadSchema = SchemaFactory.createForClass(MonthlySchedulePayload);

@Schema({ _id: false })
export class AdvancedSchedulePayload {
  @Prop({
    type: String,
    enum: ['weekdays', 'weekend', 'every_n_days'],
    required: true,
  })
  variant!: 'weekdays' | 'weekend' | 'every_n_days';

  @Prop({ type: Number, default: null })
  intervalDays!: number | null;

  @Prop({ type: String, default: null })
  timeLocal!: string | null;
  @Prop({ type: Number, default: null })
  monthOfYear!: number | null;

  @Prop({ type: Number, default: null })
  weekOfMonth!: number | null;
}

export const AdvancedSchedulePayloadSchema = SchemaFactory.createForClass(AdvancedSchedulePayload);

@Schema({ _id: false })
export class ExecutionSchedule {
  @Prop({ type: Boolean, default: false })
  enabled!: boolean;

  @Prop({ type: String, default: 'UTC' })
  timezone!: string;

  @Prop({
    type: String,
    enum: ['daily', 'weekly', 'monthly', 'advanced'],
    required: false,
  })
  type?: ExecutionScheduleType;

  @Prop({ type: Date, default: null })
  lastScheduledRunAt!: Date | null;

  @Prop({ type: DailySchedulePayloadSchema, default: null })
  daily!: DailySchedulePayload | null;

  @Prop({ type: WeeklySchedulePayloadSchema, default: null })
  weekly!: WeeklySchedulePayload | null;

  @Prop({ type: MonthlySchedulePayloadSchema, default: null })
  monthly!: MonthlySchedulePayload | null;

  @Prop({ type: AdvancedSchedulePayloadSchema, default: null })
  advanced!: AdvancedSchedulePayload | null;
}

export const ExecutionScheduleSchema = SchemaFactory.createForClass(ExecutionSchedule);
