import { useState } from 'react';
import { useModuleTranslation } from '@/modules/localization';
import { useHumanUpdateTask } from '../query/hooks';
import type { WorkyHumanUpdateKind, WorkyTask } from '../types';

interface HumanTaskPanelProps {
  streamId: string;
  tasks: WorkyTask[];
}

const KINDS: WorkyHumanUpdateKind[] = [
  'in_progress',
  'feedback',
  'request_changes',
  'blocked',
  'done',
];

/**
 * List + control surface for human-assigned tasks (Part 4 §3.3). Each
 * row exposes the 5 human-update kinds. Comments are passed through
 * to the runtime via the human-update callback.
 */
export function HumanTaskPanel({ streamId, tasks }: HumanTaskPanelProps) {
  const { t } = useModuleTranslation('worky');
  const update = useHumanUpdateTask(streamId);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [comment, setComment] = useState('');

  const humanTasks = tasks.filter((t) => t.assigneeType === 'human_agent');
  if (humanTasks.length === 0) {
    return (
      <div data-testid="human-tasks-empty" className="p-3 text-sm text-gray-500">
        {t('humanTasks.empty')}
      </div>
    );
  }

  return (
    <div data-testid="human-tasks-panel" className="space-y-2 p-3">
      <h3 className="text-sm font-semibold">{t('humanTasks.title')}</h3>
      {humanTasks.map((task) => (
        <div
          key={task.id}
          data-testid="human-task-row"
          className="rounded border border-gray-200 bg-white p-2 text-sm"
        >
          <div className="flex items-center justify-between">
            <span className="font-medium">{task.title}</span>
            <span className="rounded bg-gray-100 px-2 py-0.5 text-xs">
              {task.executionState}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {KINDS.map((kind) => (
              <button
                key={kind}
                type="button"
                data-testid={`human-task-${kind}`}
                disabled={update.isPending}
                onClick={() => {
                  setExpanded(expanded === task.id ? null : task.id);
                  setComment('');
                  update.mutate({ taskId: task.id, kind, comment: '' });
                }}
                className="rounded border border-gray-200 px-2 py-0.5 text-xs hover:bg-gray-50"
              >
                {t(`humanTasks.kinds.${kind}`)}
              </button>
            ))}
          </div>
          {expanded === task.id && (
            <textarea
              data-testid="human-task-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('humanTasks.commentPlaceholder')}
              className="mt-2 w-full rounded border border-gray-200 p-1 text-xs"
              rows={2}
            />
          )}
        </div>
      ))}
    </div>
  );
}
