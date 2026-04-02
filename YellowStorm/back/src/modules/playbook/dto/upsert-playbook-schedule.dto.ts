import {
  IsArray,
  ArrayMinSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidateIf,
  ValidateNested,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Local time HH:mm (24h). */
export const TIME_LOCAL_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

@ValidatorConstraint({ name: 'dayOfMonthSchedule', async: false })
export class DayOfMonthScheduleConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      return false;
    }
    if (value === -1) {
      return true;
    }
    if (value === 0) {
      return true;
    }
    return value >= 1 && value <= 31;
  }

  defaultMessage(): string {
    return 'dayOfMonth must be between 1 and 31, 0 for every day of the month, or -1 for last day of month';
  }
}

export class DailyScheduleDto {
  @ApiProperty({ example: ['09:00', '18:30'], description: 'One or more local times (HH:mm) in the playbook timezone' })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  @Matches(TIME_LOCAL_REGEX, { each: true, message: 'each entry must be HH:mm' })
  timesLocal!: string[];
}

export class WeeklySlotDto {
  @ApiProperty({ example: 1, description: '0 = Sunday … 6 = Saturday' })
  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number;

  @ApiProperty({ example: '14:00' })
  @IsString()
  @Matches(TIME_LOCAL_REGEX, { message: 'timeLocal must be HH:mm' })
  timeLocal!: string;
}

export class WeeklyScheduleDto {
  @ApiProperty({ type: [WeeklySlotDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => WeeklySlotDto)
  slots!: WeeklySlotDto[];
}

export class MonthlySlotDto {
  @ApiPropertyOptional({
    example: 3,
    description: '1–12: run only in this calendar month each year; omit for same day every month',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  monthOfYear?: number;

  @ApiProperty({ example: 15, description: '1–31, 0 = every day of the month, or -1 for last day' })
  @IsInt()
  @Validate(DayOfMonthScheduleConstraint)
  dayOfMonth!: number;

  @ApiProperty({ example: '08:00' })
  @IsString()
  @Matches(TIME_LOCAL_REGEX, { message: 'timeLocal must be HH:mm' })
  timeLocal!: string;
}

export class MonthlyScheduleDto {
  @ApiProperty({ type: [MonthlySlotDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => MonthlySlotDto)
  slots!: MonthlySlotDto[];
}

export class AdvancedScheduleDto {
  @ApiProperty({ enum: ['weekdays', 'weekend', 'every_n_days'] })
  @IsIn(['weekdays', 'weekend', 'every_n_days'])
  variant!: 'weekdays' | 'weekend' | 'every_n_days';

  @ApiPropertyOptional({ description: 'Required when variant is every_n_days' })
  @ValidateIf((o: AdvancedScheduleDto) => o.variant === 'every_n_days')
  @IsInt()
  @Min(1)
  @Max(366)
  intervalDays?: number;

  @ApiPropertyOptional({ example: '09:00', nullable: true })
  @IsOptional()
  @IsString()
  @Matches(TIME_LOCAL_REGEX, { message: 'timeLocal must be HH:mm' })
  timeLocal?: string | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'weekend only: 1–12, omit/null = every month',
  })
  @ValidateIf((o: AdvancedScheduleDto) => o.variant === 'weekend' && o.monthOfYear != null)
  @IsInt()
  @Min(1)
  @Max(12)
  monthOfYear?: number | null;

  @ApiPropertyOptional({
    nullable: true,
    description: 'weekend only: 1–5 (week bands by calendar day), omit/null = every week',
  })
  @ValidateIf((o: AdvancedScheduleDto) => o.variant === 'weekend' && o.weekOfMonth != null)
  @IsInt()
  @Min(1)
  @Max(5)
  weekOfMonth?: number | null;
}

export class UpsertPlaybookScheduleDto {
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({
    example: 'Europe/Paris',
    description: 'IANA timezone; required when enabled is true',
  })
  @ValidateIf((o: UpsertPlaybookScheduleDto) => o.enabled === true)
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({
    enum: ['daily', 'weekly', 'monthly', 'advanced'],
    description: 'Schedule mode; required when enabled is true',
  })
  @ValidateIf((o: UpsertPlaybookScheduleDto) => o.enabled === true)
  @IsIn(['daily', 'weekly', 'monthly', 'advanced'])
  type?: 'daily' | 'weekly' | 'monthly' | 'advanced';

  @ApiPropertyOptional({ type: DailyScheduleDto })
  @ValidateIf((o: UpsertPlaybookScheduleDto) => o.enabled === true && o.type === 'daily')
  @ValidateNested()
  @Type(() => DailyScheduleDto)
  daily?: DailyScheduleDto;

  @ApiPropertyOptional({ type: WeeklyScheduleDto })
  @ValidateIf((o: UpsertPlaybookScheduleDto) => o.enabled === true && o.type === 'weekly')
  @ValidateNested()
  @Type(() => WeeklyScheduleDto)
  weekly?: WeeklyScheduleDto;

  @ApiPropertyOptional({ type: MonthlyScheduleDto })
  @ValidateIf((o: UpsertPlaybookScheduleDto) => o.enabled === true && o.type === 'monthly')
  @ValidateNested()
  @Type(() => MonthlyScheduleDto)
  monthly?: MonthlyScheduleDto;

  @ApiPropertyOptional({ type: AdvancedScheduleDto })
  @ValidateIf((o: UpsertPlaybookScheduleDto) => o.enabled === true && o.type === 'advanced')
  @ValidateNested()
  @Type(() => AdvancedScheduleDto)
  advanced?: AdvancedScheduleDto;
}
