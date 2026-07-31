import { useModuleTranslation } from '@/modules/localization';
import { AIMessageContent } from '@/components/ai-elements/ai-message-content';
import { MessageProvider } from '@/components/ai-elements/message-context';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTaskResults } from '../query/hooks';
import type { WorkyTask, WorkyTaskResult } from '../types';

interface TaskDetailDrawerProps {
  task: WorkyTask | null;
  onClose: () => void;
}

/**
 * Read-only task detail drawer: description, dependencies and the step's result.
 * The per-task lane controls (move / pause / resume / review / cancel) were
 * removed — they wrote Mongo lanes that the next Electric `plan_steps` update
 * overwrote, so they had no lasting effect. Raw payloads are admin-only per
 * canonical §9; this is the owner view.
 */
export function TaskDetailDrawer({ task, onClose }: TaskDetailDrawerProps): JSX.Element | null {
  const { t: tWorky } = useModuleTranslation('worky');
  const results = useTaskResults(task?.id);

  if (!task) return null;
  const latestResult = results.data?.[0] ?? null;

  return (
    <div
      className='fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-border bg-card shadow-lg'
      role='dialog'
      aria-label={tWorky('taskDetail.title')}
      data-testid='task-detail-drawer'
    >
      <div className='flex items-center justify-between border-b border-border px-4 py-3'>
        <h2 className='truncate text-sm font-semibold'>{tWorky('taskDetail.title')}: {task.title}</h2>
        <button
          type='button'
          onClick={onClose}
          className='text-xs text-muted-foreground'
          aria-label={tWorky('taskDetail.close')}
        >
          ✕
        </button>
      </div>
      <div className='flex-1 overflow-y-auto px-4 py-3 text-sm'>
        <Tabs defaultValue='details' className='space-y-4'>
          <TabsList className='grid w-full grid-cols-2'>
            <TabsTrigger value='details'>{tWorky('taskDetail.tabs.details')}</TabsTrigger>
            <TabsTrigger value='results'>{tWorky('taskDetail.tabs.results')}</TabsTrigger>
          </TabsList>
          <TabsContent value='details' className='space-y-4'>
            <p className='whitespace-pre-wrap text-muted-foreground'>{task.description}</p>
            {task.dependsOn.length > 0 ? (
              <div>
                <h3 className='text-xs font-semibold'>{tWorky('taskDetail.dependsOn')}</h3>
                <ul className='mt-1 list-inside list-disc text-xs text-muted-foreground'>
                  {task.dependsOn.map((dep) => (
                    <li key={dep}>{dep}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {task.blockerReason ? (
              <div className='rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700'>
                {tWorky('taskDetail.blocker', { reason: task.blockerReason })}
              </div>
            ) : null}
          </TabsContent>
          <TabsContent value='results' className='space-y-3'>
            {task.result ? (
              <div className='rounded-md border border-border bg-background px-3 py-2'>
                <MessageProvider>
                  <AIMessageContent parts={[{ type: 'text', content: task.result }]} />
                </MessageProvider>
              </div>
            ) : results.isLoading ? (
              <p className='text-xs text-muted-foreground'>{tWorky('taskDetail.results.loading')}</p>
            ) : latestResult ? (
              <TaskResultPanel result={latestResult} />
            ) : (
              <p className='text-xs text-muted-foreground'>{tWorky('taskDetail.results.empty')}</p>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function TaskResultPanel({ result }: { result: WorkyTaskResult }): JSX.Element {
  const { t: tWorky } = useModuleTranslation('worky');
  const text = result.summary || extractPayloadText(result.payload);
  return (
    <div className='space-y-3'>
      <div className='text-xs font-medium text-muted-foreground'>
        {tWorky('taskDetail.results.version', { version: result.version, status: result.status })}
      </div>
      {text ? (
        <div className='rounded-md border border-border bg-background px-3 py-2'>
          <MessageProvider>
            <AIMessageContent parts={[{ type: 'text', content: text }]} />
          </MessageProvider>
        </div>
      ) : null}
      {result.payload ? (
        <details className='rounded-md border border-border bg-muted/30 px-3 py-2 text-xs'>
          <summary className='cursor-pointer font-medium'>{tWorky('taskDetail.results.payload')}</summary>
          <pre className='mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words'>
            {JSON.stringify(result.payload, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function extractPayloadText(payload: Record<string, unknown> | null): string {
  if (!payload) return '';
  const value = payload.output ?? payload.result ?? payload.text ?? payload.content;
  return typeof value === 'string' ? value : '';
}

