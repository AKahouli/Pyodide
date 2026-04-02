import { usePlaybookStore } from '../store';

export function useScheduleSaving() {
  return usePlaybookStore((s) => s.scheduleSaving);
}

export function useScheduleError() {
  return usePlaybookStore((s) => s.scheduleError);
}
