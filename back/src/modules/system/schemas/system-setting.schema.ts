import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, HydratedDocument } from 'mongoose';

export type SystemSettingDocument = HydratedDocument<SystemSetting>;

@Schema({ _id: false })
export class MaintenanceValue {
  @Prop({ required: true, default: false })
  enabled!: boolean;

  @Prop({ required: true, default: 'System is under maintenance. Please try again later.' })
  message!: string;

  @Prop()
  startedAt?: Date;

  @Prop()
  startedBy?: string;

  @Prop()
  estimatedEndAt?: Date;
}

@Schema({ _id: false })
export class RegistrationValue {
  @Prop({ required: true, default: true })
  enabled!: boolean;

  @Prop()
  disabledAt?: Date;

  @Prop()
  disabledBy?: string;

  @Prop({ default: true })
  classicAuthEnabled?: boolean;
}

@Schema({ _id: false })
export class AppearanceThemeValue {
  @Prop({ required: true })
  labelKey!: string;

  @Prop({ required: true, enum: ['yellowmind', 'kpmg'] })
  logo!: string;
}

@Schema({ _id: false })
export class AppearanceValue {
  @Prop({ required: true, default: 'default', enum: ['default', 'yellow', 'orange', 'blue'] })
  defaultColorTheme!: string;

  @Prop({
    type: Object,
    required: true,
    default: {
      default: { labelKey: 'appearance.colorTheme.default', logo: 'yellowmind' },
      yellow: { labelKey: 'appearance.colorTheme.yellow', logo: 'yellowmind' },
      orange: { labelKey: 'appearance.colorTheme.orange', logo: 'kpmg' },
      blue: { labelKey: 'appearance.colorTheme.blue', logo: 'kpmg' },
    },
  })
  themes!: Record<string, AppearanceThemeValue>;
}

@Schema({
  timestamps: true,
  collection: 'system_settings',
})
export class SystemSetting extends Document {
  @Prop({ required: true, unique: true, index: true })
  key!: string;

  @Prop({ type: Object, required: true })
  value!: MaintenanceValue | RegistrationValue | AppearanceValue | Record<string, unknown>;

  createdAt!: Date;
  updatedAt!: Date;
}

export const SystemSettingSchema = SchemaFactory.createForClass(SystemSetting);

// Transform for JSON output
SystemSettingSchema.set('toJSON', {
  virtuals: true,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transform: (_doc: any, ret: any) => {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});
