import { useState } from 'react';
import { Download, Eye, FileText, Loader2, MessageSquare, X } from 'lucide-react';
import { useModuleTranslation } from '@/modules/localization';
import { showError } from '@/lib/notifications';
import { AIMessageContent } from '@/components/ai-elements/ai-message-content';
import type { MessageContentPart } from '@/components/ai-elements/ai-message-content';
import { MessageProvider } from '@/components/ai-elements/message-context';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { openFileViewerFromUrlLoader, getMimeTypeFromFilename } from '@/modules/file-viewer';
import { mapComponentsToContentParts } from '@/modules/conversation/utils';
import { getTaskArtifactUrl } from '../api';
import { useTaskResultContent, useTaskResults } from '../query/hooks';
import type { WorkyArtifact, WorkyTask, WorkyTaskResult, WorkyTaskResultContent } from '../types';
import { TaskTimestamp } from './TaskTimestamp';

interface TaskDetailDrawerProps {
  task: WorkyTask | null;
  onClose: () => void;
  tasks?: WorkyTask[];
  onSelectTask?: (task: WorkyTask) => void;
  onDiscuss?: () => void;
}

/** Renderable component parts from a step's result-content. Artifacts are NOT
 *  included here — the generic 'artifact' part is a static card; the drawer
 *  renders artifacts as clickable cards (TaskArtifactCard) that open the file
 *  viewer, the same way the conversation does. */
export function buildResultParts(content: WorkyTaskResultContent): MessageContentPart[] {
  return mapComponentsToContentParts(content.components);
}

/** A generated artifact row — identical to the conversation's ArtifactRow: View
 *  opens the file in the viewer via a short-lived signed URL, Download saves it,
 *  both with a loading spinner and an error toast on failure. */
function TaskArtifactCard({ taskId, artifact }: { taskId: string; artifact: WorkyArtifact }): JSX.Element {
  const { t } = useModuleTranslation('conversation');
  const [loadingAction, setLoadingAction] = useState<'view' | 'download' | null>(null);
  const filename = artifact.filename || t('stream.activity.generated');
  const mimeType = artifact.mimeType || getMimeTypeFromFilename(artifact.filename) || 'application/octet-stream';

  const view = async () => {
    if (loadingAction) return;
    setLoadingAction('view');
    try {
      await openFileViewerFromUrlLoader(
        JSON.stringify([taskId, artifact.id]),
        filename,
        mimeType,
        async () => {
          const { viewUrl } = await getTaskArtifactUrl(taskId, artifact.id);
          return { url: viewUrl };
        },
      );
    } catch {
      showError(t('stream.activity.artifactError'));
    } finally {
      setLoadingAction(null);
    }
  };

  const download = async () => {
    if (loadingAction) return;
    setLoadingAction('download');
    try {
      const { downloadUrl } = await getTaskArtifactUrl(taskId, artifact.id);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      anchor.download = filename;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch {
      showError(t('stream.activity.artifactError'));
    } finally {
      setLoadingAction(null);
    }
  };

  const disabled = Boolean(loadingAction);
  return (
    <div className='flex items-center gap-3 rounded-lg border bg-background/50 px-3 py-2 text-sm'>
      <FileText className='size-4 text-primary' aria-hidden='true' />
      <span className='min-w-0 flex-1 truncate'>{filename}</span>
      <button type='button' disabled={disabled} onClick={view} className='inline-flex items-center gap-1 font-medium text-primary disabled:text-muted-foreground'>
        {loadingAction === 'view' ? <Loader2 className='size-3.5 animate-spin' aria-hidden='true' /> : <Eye className='size-3.5' aria-hidden='true' />}
        {t('stream.activity.viewArtifact')}
      </button>
      <button type='button' disabled={disabled} onClick={download} className='inline-flex items-center gap-1 font-medium text-primary disabled:text-muted-foreground'>
        {loadingAction === 'download' ? <Loader2 className='size-3.5 animate-spin' aria-hidden='true' /> : <Download className='size-3.5' aria-hidden='true' />}
        {t('stream.activity.downloadArtifact')}
      </button>
    </div>
  );
}

/**
 * Read-only task detail drawer: description, dependencies and the step's result.
 * The per-task lane controls (move / pause / resume / review / cancel) were
 * removed — they wrote Mongo lanes that the next Electric `plan_steps` update
 * overwrote, so they had no lasting effect. Raw payloads are admin-only per
 * canonical §9; this is the owner view.
 */
export function TaskDetailDrawer({ task, onClose, tasks = [], onSelectTask, onDiscuss }: TaskDetailDrawerProps): JSX.Element | null {
  const { t: tWorky } = useModuleTranslation('worky');
  const results = useTaskResults(task?.id);
  const resultContent = useTaskResultContent(task?.id);

  if (!task) return null;
  const latestResult = results.data?.[0] ?? null;
  const richParts = resultContent.data ? buildResultParts(resultContent.data) : [];
  const artifacts = resultContent.data?.artifacts ?? [];
  const byStepId = new Map(tasks.filter((item) => item.externalId).map((item) => [item.externalId, item]));
  const prerequisites = (task.dependsOnStepIds ?? []).map((id) => byStepId.get(id)).filter((item): item is WorkyTask => Boolean(item));
  const downstream = tasks.filter((item) => task.externalId && item.dependsOnStepIds?.includes(task.externalId));

  return (
    <div
      className='flex w-full flex-col border-border bg-card shadow-lg lg:h-full lg:min-h-0 lg:w-[380px] lg:shrink-0 lg:border-l'
      role='region'
      aria-label={tWorky('taskDetail.title')}
      data-testid='task-detail-drawer'
    >
      <div className='flex items-center justify-between border-b border-border px-4 py-3'>
        <h2 className='truncate text-sm font-semibold'>{tWorky('taskDetail.title')}: {task.title}</h2>
        {onDiscuss && <button type='button' onClick={onDiscuss} className='ml-auto mr-1 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary' aria-label={tWorky('command.chat.discuss')} title={tWorky('command.chat.discuss')}><MessageSquare className='size-4' /></button>}
        <button
          type='button'
          onClick={onClose}
          className='flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary'
          aria-label={tWorky('taskDetail.close')}
        >
          <X className='size-4' />
        </button>
      </div>
      <div className='flex-1 overflow-y-auto px-4 py-3 text-sm'>
        <Tabs defaultValue='details' className='space-y-4'>
          <TabsList className='grid w-full grid-cols-2'>
            <TabsTrigger value='details'>{tWorky('taskDetail.tabs.details')}</TabsTrigger>
            <TabsTrigger value='results'>{tWorky('taskDetail.tabs.results')}</TabsTrigger>
          </TabsList>
          <TabsContent value='details' className='space-y-4'>
            <div className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'><span className='rounded-md bg-muted px-2 py-1 font-medium text-foreground'>{tWorky(`kanban.lanes.${task.lane}` as 'kanban.lanes.running')}</span>{task.assigneeName || task.assigneeKey || tWorky('command.queue.unassigned')}<TaskTimestamp task={task} /></div>
            <p className='whitespace-pre-wrap text-muted-foreground'>{task.description}</p>
            {prerequisites.length > 0 ? <div><h3 className='text-xs font-semibold'>{tWorky('taskDetail.dependsOn')}</h3><div className='mt-1 space-y-1'>{prerequisites.map((dependency) => <button key={dependency.id} type='button' onClick={() => onSelectTask?.(dependency)} className='block w-full rounded-md border border-border px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary' disabled={!onSelectTask}>{dependency.title} · {tWorky(`kanban.lanes.${dependency.lane}` as 'kanban.lanes.running')}</button>)}</div></div> : task.dependsOn.length > 0 ? (
              <div>
                <h3 className='text-xs font-semibold'>{tWorky('taskDetail.dependsOn')}</h3>
                <ul className='mt-1 list-inside list-disc text-xs text-muted-foreground'>
                  {task.dependsOn.map((dep) => (
                    <li key={dep}>{dep}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {downstream.length > 0 && <div><h3 className='text-xs font-semibold'>{tWorky('command.detail.downstream')}</h3><div className='mt-1 space-y-1'>{downstream.map((dependent) => <button key={dependent.id} type='button' onClick={() => onSelectTask?.(dependent)} className='block w-full rounded-md border border-border px-2 py-1.5 text-left text-xs text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary' disabled={!onSelectTask}>{dependent.title} · {tWorky(`kanban.lanes.${dependent.lane}` as 'kanban.lanes.running')}</button>)}</div></div>}
            {task.blockedReason || task.blockerReason ? (
              <div className='rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700'>
                {tWorky('taskDetail.blocker', { reason: task.blockedReason || task.blockerReason })}
              </div>
            ) : null}
          </TabsContent>
          <TabsContent value='results' className='space-y-3'>
            {richParts.length > 0 || artifacts.length > 0 ? (
              <div className='space-y-3'>
                {richParts.length > 0 ? (
                  <div className='rounded-md border border-border bg-background px-3 py-2'>
                    <MessageProvider fileViewerDisplayMode='floating'>
                      <AIMessageContent parts={richParts} />
                    </MessageProvider>
                  </div>
                ) : null}
                {artifacts.map((a) => (
                  <TaskArtifactCard key={a.id || a.filePath} taskId={task.id} artifact={a} />
                ))}
              </div>
            ) : task.result ? (
              <div className='rounded-md border border-border bg-background px-3 py-2'>
                <MessageProvider fileViewerDisplayMode='floating'>
                  <AIMessageContent parts={[{ type: 'text', content: task.result }]} />
                </MessageProvider>
              </div>
            ) : results.isLoading || resultContent.isLoading ? (
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
          <MessageProvider fileViewerDisplayMode='floating'>
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

