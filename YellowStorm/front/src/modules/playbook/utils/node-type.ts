import type { PlaybookNodeType, PlaybookTask } from '../types';

export function getEffectiveNodeType(task: Pick<PlaybookTask, 'nodeType' | 'taskType' | 'executionMode'>): PlaybookNodeType {
  if (task.nodeType) {
    return task.nodeType;
  }
  if (task.taskType === 'evaluation') {
    return 'evaluation';
  }
  if (task.taskType === 'iterator') {
    return 'iterator';
  }
  if (task.executionMode === 'action') {
    return 'action';
  }
  return 'agent';
}
