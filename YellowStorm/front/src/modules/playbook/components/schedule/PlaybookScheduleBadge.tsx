import { CalendarClock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { summarizeExecutionSchedule } from '../../utils/scheduleDisplay';
import type { ExecutionScheduleData } from '../../types';

interface Props {
  schedule: ExecutionScheduleData | null | undefined;
  className?: string;
}

export function PlaybookScheduleBadge({ schedule, className }: Props) {
  if (!schedule?.enabled || !schedule.type) {
    return null;
  }
  const label = summarizeExecutionSchedule(schedule);
  if (!label) return null;
  return (
    <Badge variant="secondary" className={`gap-1 font-normal max-w-[220px] truncate ${className ?? ''}`} title={label}>
      <CalendarClock className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </Badge>
  );
}
