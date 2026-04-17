import { usePlaybookStore } from '../store';

export function useScheduleSaving() {
  return usePlaybookStore((s) => s.triggerSaving);
}

export function useScheduleError() {
  return usePlaybookStore((s) => s.triggerError);
}
