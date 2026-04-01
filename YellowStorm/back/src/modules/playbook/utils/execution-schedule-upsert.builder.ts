import { BadRequestException, ErrorCode } from '../../exceptions';
import { UpsertPlaybookScheduleDto } from '../dto/upsert-playbook-schedule.dto';

type ScheduleModeFields = 'daily' | 'weekly' | 'monthly' | 'advanced';

/**
 * Maps an upsert DTO to the Mongo subdocument shape for `executionSchedule`.
 * Callers are responsible for loading `preserveLastRunAt` when re-enabling a schedule.
 */
export function buildExecutionScheduleDocument(
  dto: UpsertPlaybookScheduleDto,
  preserveLastRunAt: Date | null,
): Record<string, unknown> {
  if (!dto.enabled) {
    return {
      enabled: false,
      timezone: dto.timezone ?? 'UTC',
      type: dto.type,
      lastScheduledRunAt: null,
      daily: null,
      weekly: null,
      monthly: null,
      advanced: null,
    };
  }

  const timezone = dto.timezone ?? 'UTC';
  const type = dto.type;
  if (!type) {
    throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Schedule type is required when enabled');
  }

  switch (type) {
    case 'daily':
      return enabledEnvelope(timezone, 'daily', preserveLastRunAt, {
        daily: { timesLocal: [...dto.daily!.timesLocal] },
      });
    case 'weekly':
      return enabledEnvelope(timezone, 'weekly', preserveLastRunAt, {
        weekly: {
          slots: dto.weekly!.slots.map((s) => ({
            weekday: s.weekday,
            timeLocal: s.timeLocal,
          })),
        },
      });
    case 'monthly':
      return enabledEnvelope(timezone, 'monthly', preserveLastRunAt, {
        monthly: {
          slots: dto.monthly!.slots.map((s) => ({
            dayOfMonth: s.dayOfMonth,
            timeLocal: s.timeLocal,
          })),
        },
      });
    case 'advanced': {
      const adv = dto.advanced!;
      return enabledEnvelope(timezone, 'advanced', preserveLastRunAt, {
        advanced: {
          variant: adv.variant,
          intervalDays: adv.variant === 'every_n_days' ? adv.intervalDays ?? null : null,
          timeLocal: adv.timeLocal ?? null,
        },
      });
    }
    default:
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Invalid schedule type');
  }
}

function enabledEnvelope(
  timezone: string,
  type: NonNullable<UpsertPlaybookScheduleDto['type']>,
  lastScheduledRunAt: Date | null,
  payload: Partial<Pick<Record<string, unknown>, ScheduleModeFields>>,
): Record<string, unknown> {
  return {
    enabled: true,
    timezone,
    type,
    lastScheduledRunAt,
    daily: payload.daily ?? null,
    weekly: payload.weekly ?? null,
    monthly: payload.monthly ?? null,
    advanced: payload.advanced ?? null,
  };
}
