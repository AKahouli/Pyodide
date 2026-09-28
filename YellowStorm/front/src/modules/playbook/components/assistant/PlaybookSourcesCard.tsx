import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileText, FolderSearch, Loader2, SkipForward, Warehouse } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import type { ModuleTranslationKey, TranslationParams } from '@/modules/localization/types';
import { SourceChooserDialog } from '@/modules/semantic-model/components/assistant/SourceChooser';
import type { SourceSuggestionOption } from '@/modules/semantic-model/types';
import {
  choosePlaybookSources,
  getPlaybookSourceQuestions,
  searchPlaybookSourceFiles,
  type PlaybookSourceQuestion,
  type PlaybookSourceQuestions,
} from '../../assistant-sources-api';

type Translate = (key: ModuleTranslationKey<'platform-copilot'>, params?: TranslationParams) => string;

const sourcesKey = (continuationId: string) => ['playbook', 'assistant-sources', continuationId];
/** The questions were answered (Yellowmind continued) or expired. */
const isGone = (error: unknown) => (error as { statusCode?: number } | null)?.statusCode === 404;

/** The Yellowmind message that says what was chosen, by name, so the assistant continues. */
export function sourcesMessage(questions: PlaybookSourceQuestion[], t: Translate) {
  const lines = questions.map((question) => `${question.question}: ${describeChoice(question, t)}`);
  return t('playbookSources.continueMessage', { choices: lines.join('; ') });
}

function describeChoice(question: PlaybookSourceQuestion, t: Translate) {
  if (!question.choice) return t('playbookSources.notChosen');
  if (question.choice.skipped) return t('playbookSources.skipped');
  if (question.choice.option) return question.choice.option;
  return question.choice.resources.map((resource) => resource.kind === 'workspace'
    ? t('playbookSources.workspaceChoice', { name: resource.name })
    : t('playbookSources.fileChoice', { name: resource.name, workspace: resource.workspaceName })).join(', ');
}

/**
 * An answer of the question that points at a workspace or a document ('Workspace "CV"', "A job description
 * stored in a workspace") is chosen in the searchable list, starting from the name it quotes, if any.
 */
export function workspaceAnswer(choice: string): { search: string } | null {
  if (!/workspace|espace|document|folder|dossier/i.test(choice)) return null;
  const quoted = /["“«]\s*([^"”»]+?)\s*["”»]/.exec(choice);
  return { search: quoted?.[1] ?? '' };
}

function toResources(option: SourceSuggestionOption): Array<{ kind: 'workspace' | 'document'; id: string }> {
  if (option.kind === 'workspace') return [{ kind: 'workspace', id: option.workspaceId }];
  return option.documentIds.map((id) => ({ kind: 'document' as const, id }));
}

/**
 * The questions Yellowmind asks for a playbook's sources, answered here by the person: they choose from a
 * searchable list of all their workspaces and files, or skip a question so the playbook asks for it when it
 * runs. The choices are kept with the waiting questions; Yellowmind only continues once told to.
 */
export function PlaybookSourcesCard({ continuationId, playbookName, onSend, continueInPanel = false }: Readonly<{
  continuationId: string;
  playbookName?: string;
  /** Sends a message to Yellowmind; without it, the person tells Yellowmind to continue themselves. */
  onSend?: (text: string) => Promise<boolean> | boolean | void;
  /** Outside the conversation (in the designer): the message is written in Yellowmind for the person to send. */
  continueInPanel?: boolean;
}>) {
  const { t } = useModuleTranslation('platform-copilot');
  const queryClient = useQueryClient();
  const [choosing, setChoosing] = useState<{ question: PlaybookSourceQuestion; search: string } | null>(null);
  const [sent, setSent] = useState(false);
  const sources = useQuery({
    queryKey: sourcesKey(continuationId),
    queryFn: () => getPlaybookSourceQuestions(continuationId),
    retry: (count, error) => !isGone(error) && count < 2,
  });
  const choose = useMutation({
    mutationFn: ({ questionId, choice }: { questionId: string; choice: Parameters<typeof choosePlaybookSources>[2] }) =>
      choosePlaybookSources(continuationId, questionId, choice),
    onSuccess: (data) => queryClient.setQueryData<PlaybookSourceQuestions>(sourcesKey(continuationId), data),
  });

  const answered = isGone(sources.error);
  if (answered || (sent && !sources.data)) {
    return <p className='rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground'>{t('playbookSources.answered')}</p>;
  }
  const name = sources.data?.playbookName ?? playbookName;
  const questions = sources.data?.questions ?? [];
  const ready = questions.length > 0 && questions.every((question) => !question.required || question.choice);

  const send = async () => {
    if (!onSend || !ready) return;
    const ok = await onSend(sourcesMessage(questions, t));
    if (ok !== false && !continueInPanel) setSent(true);
  };

  return <section className='rounded-xl border bg-background p-3 shadow-sm' aria-label={t('playbookSources.title')} data-testid='playbook-sources-card'>
    <div className='flex items-start gap-2.5'>
      <span className='grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary'><FolderSearch className='size-4' /></span>
      <div className='min-w-0'>
        <h3 className='text-sm font-medium'>{name ? t('playbookSources.titleFor', { name }) : t('playbookSources.title')}</h3>
        <p className='text-xs text-muted-foreground'>{t('playbookSources.description')}</p>
      </div>
    </div>
    {sources.isLoading ? <div className='flex justify-center p-3'><Loader2 className='size-4 animate-spin text-primary' /></div>
      : sources.isError ? <div className='mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground'>
        <span>{t('playbookSources.loadError')}</span>
        <Button type='button' size='sm' variant='ghost' onClick={() => void sources.refetch()}>{t('playbookSources.retry')}</Button>
      </div>
      : <ul className='mt-3 space-y-2'>
        {questions.map((question) => {
          const choice = question.choice;
          const workspaceOnly = question.selector === 'destination_workspace';
          const busy = choose.isPending && choose.variables?.questionId === question.id;
          return <li key={question.id} className='rounded-lg border bg-card p-2.5'>
            <p className='text-sm font-medium'>{question.question}</p>
            {question.reason && <p className='text-xs text-muted-foreground'>{question.reason}</p>}
            <p className={`mt-1.5 flex items-start gap-1.5 text-xs ${!choice && question.required ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`} aria-live='polite'>
              {!choice ? null : choice.skipped ? <SkipForward className='mt-0.5 size-3.5 shrink-0' />
                : <CheckCircle2 className='mt-0.5 size-3.5 shrink-0 text-emerald-600' />}
              <span className={choice && !choice.skipped ? 'text-foreground' : ''}>{describeChoice(question, t)}</span>
            </p>
            {question.choices.length > 0 && <div className='mt-2 flex flex-wrap gap-1.5' role='group' aria-label={t('playbookSources.answers')}>
              {question.choices.map((answer) => {
                const inList = workspaceAnswer(answer);
                const picked = !inList && choice && !choice.skipped && choice.option === answer;
                return <Button key={answer} type='button' size='sm' variant='outline' aria-pressed={Boolean(picked)} disabled={busy || sent}
                  className={`h-auto min-h-8 whitespace-normal py-1 text-left text-xs ${picked ? 'border-primary bg-primary/10' : ''}`}
                  onClick={() => inList ? setChoosing({ question, search: inList.search }) : choose.mutate({ questionId: question.id, choice: { choice: answer } })}>
                  {answer}
                </Button>;
              })}
            </div>}
            <div className='mt-2 flex flex-wrap gap-1.5'>
              <Button type='button' size='sm' variant={choice && !choice.skipped ? 'outline' : 'default'} className='h-8 gap-1.5 text-xs' disabled={busy || sent}
                onClick={() => setChoosing({ question, search: '' })}>
                {workspaceOnly ? <Warehouse className='size-3.5' /> : <FileText className='size-3.5' />}
                {choice && !choice.skipped && !choice.option ? t('playbookSources.change') : workspaceOnly ? t('playbookSources.chooseWorkspace') : t('playbookSources.chooseFiles')}
              </Button>
              {!choice?.skipped && <Button type='button' size='sm' variant='ghost' className='h-8 text-xs' disabled={busy || sent}
                onClick={() => choose.mutate({ questionId: question.id, choice: { skip: true } })}>{t('playbookSources.skip')}</Button>}
              {busy && <Loader2 className='size-4 animate-spin self-center text-primary' />}
            </div>
          </li>;
        })}
      </ul>}
    {choose.isError && <p className='mt-2 text-xs text-destructive'>{t('playbookSources.saveError')}</p>}
    {questions.length > 0 && (onSend
      ? <Button type='button' size='sm' className='mt-3 w-full' disabled={!ready || sent || choose.isPending} onClick={() => void send()}>
        {sent ? t('playbookSources.sent') : t(continueInPanel ? 'playbookSources.continueInPanel' : 'playbookSources.continue')}
      </Button>
      : <p className='mt-2 text-xs text-muted-foreground'>{t('playbookSources.tellToContinue')}</p>)}
    <SourceChooserDialog
      open={Boolean(choosing)}
      conceptLabel={choosing?.question.question ?? ''}
      initialSearch={choosing?.search}
      mode={choosing?.question.selector === 'destination_workspace' ? 'workspace' : 'files'}
      searchFiles={async (term) => ({ files: (await searchPlaybookSourceFiles(term)).files.map((file) => ({ ...file, kind: 'document' as const })) })}
      title={choosing?.question.question}
      description={choosing?.question.selector === 'destination_workspace' ? t('playbookSources.chooserWorkspace') : t('playbookSources.chooserFiles')}
      useLabel={t('playbookSources.use')}
      onClose={() => setChoosing(null)}
      onChoose={(option) => {
        if (choosing) choose.mutate({ questionId: choosing.question.id, choice: { resources: toResources(option) } });
        setChoosing(null);
      }} />
  </section>;
}
