import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ExecutionScheduleType } from '../../types';
import type { PlaybookScheduleT } from './scheduleTranslate';

interface Props {
  type: ExecutionScheduleType;
  onTypeChange: (type: ExecutionScheduleType) => void;
  t: PlaybookScheduleT;
}

export function ScheduleTypeSelector({ type, onTypeChange, t }: Props) {
  return (
    <div className="space-y-2">
      <Label>{t('schedule.mode')}</Label>
      <Select value={type} onValueChange={(v) => onTypeChange(v as ExecutionScheduleType)}>
        <SelectTrigger aria-label={t('schedule.mode')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="daily">{t('schedule.type.daily')}</SelectItem>
          <SelectItem value="weekly">{t('schedule.type.weekly')}</SelectItem>
          <SelectItem value="monthly">{t('schedule.type.monthly')}</SelectItem>
          <SelectItem value="advanced">{t('schedule.type.advanced')}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
