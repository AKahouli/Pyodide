import { useState, type JSX } from 'react';
import ReactMarkdown from 'react-markdown';
import { ChevronDown, Mail, MessageSquare, Pencil, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { normalizeChoiceComponentData } from '@/modules/conversation/utils';
import { useSendMessage } from '../../query/hooks';
import { useWorkyStore } from '../../store';
import { useWorkyUiStore } from '../../uiStore';
import type { WorkyPendingApproval } from '../../executive/executiveModel';

const APPROVE_WORDS = new Set(['approve', 'approuver', 'yes', 'oui']);

/** One pending send (email/Teams) awaiting the owner's approval, shown in
 *  "Needs you" as a quick-action row: channel + recipient + a one-line snippet
 *  with Approve/Reject on the row. A "Preview" toggle expands a compact,
 *  editable draft (À / Objet / Message) — the single source of the edits the
 *  row's Approve submits. No duplicated prompt or buttons. */
export function PendingApprovalCard({ streamId, approval }: { streamId: string; approval: WorkyPendingApproval }): JSX.Element | null {
  const { t } = useModuleTranslation('worky');
  const choice = normalizeChoiceComponentData(approval.component.data);
  const fields = choice?.fields ?? [];
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.value ?? ''])));
  const send = useSendMessage(streamId);
  const beginTurn = useWorkyStore((state) => state.beginTurn);
  const finishTurn = useWorkyStore((state) => state.finishTurn);
  const notifySendError = useWorkyUiStore((state) => state.notifySendError);

  if (!choice) return null;

  // Email cards carry a `subject` field; message/Teams cards carry `message`.
  const isEmail = fields.some((f) => f.key === 'subject');
  const recipient = values.to_recipients || values.user_email || '';
  const snippet = (isEmail ? values.subject : values.message) || choice.prompt;
  const channelLabel = isEmail ? t('executive.needsYou.approvalEmail') : t('executive.needsYou.approvalTeams');
  const Icon = isEmail ? Mail : MessageSquare;

  const approveOption = choice.options.find((o) => APPROVE_WORDS.has(o.submitText.trim().toLowerCase()));
  const rejectOption = choice.options.find((o) => !APPROVE_WORDS.has(o.submitText.trim().toLowerCase()));

  const send_ = (content: string): void => {
    if (send.isPending) return;
    const turnId = crypto.randomUUID();
    beginTurn(turnId);
    send.mutate({ content, turnId }, {
      onError: (error) => {
        finishTurn(turnId);
        notifySendError(error.message || t('promptBar.sendFailed'));
      },
    });
  };

  // Confirm-gate payload the backend expects: verdict + THIS card's questionId,
  // and on approve the (possibly edited) field values so edits reach the send.
  const approve = (): void => {
    if (!approveOption) return;
    send_(JSON.stringify({
      verdict: approveOption.submitText,
      questionId: choice.questionId,
      ...(choice.editable && fields.length ? { edits: values } : {}),
    }));
  };
  const reject = (): void => {
    if (!rejectOption) return;
    send_(JSON.stringify({ verdict: rejectOption.submitText, questionId: choice.questionId }));
  };

  const cancelEdit = (): void => {
    setValues(Object.fromEntries(fields.map((f) => [f.key, f.value ?? ''])));
    setEditing(false);
  };

  return (
    <article className='rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3'>
      <div className='flex items-start gap-3'>
        <Icon className='mt-0.5 size-4 shrink-0 text-amber-600' aria-hidden='true' />
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-x-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300'>
            {channelLabel}
            {recipient ? <span className='font-normal normal-case text-muted-foreground'>· {recipient}</span> : null}
          </div>
          <p className='mt-0.5 line-clamp-1 text-sm text-foreground'>{snippet}</p>
        </div>
        <div className='flex shrink-0 items-center gap-1.5'>
          {approveOption ? <Button size='sm' onClick={approve} disabled={send.isPending}>{t('approval.approve')}</Button> : null}
          {rejectOption ? <Button size='sm' variant='outline' onClick={reject} disabled={send.isPending}>{t('approval.reject')}</Button> : null}
        </div>
      </div>

      <button
        type='button'
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className='mt-2 inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground'
      >
        <ChevronDown className={cn('size-3.5 transition-transform', expanded && 'rotate-180')} aria-hidden='true' />
        {t('executive.needsYou.approvalReview')}
      </button>

      {expanded ? (
        <div className='mt-2 overflow-hidden rounded-lg border bg-background/60'>
          <div className='flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-1.5'>
            <span className='text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
              {t('executive.needsYou.approvalMessage')}
            </span>
            {choice.editable && fields.length ? (
              editing ? (
                <button type='button' onClick={cancelEdit} className='inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'>
                  <X className='size-3.5' aria-hidden='true' />{t('approval.cancelEdit')}
                </button>
              ) : (
                <button type='button' disabled={send.isPending} onClick={() => setEditing(true)} className='inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50'>
                  <Pencil className='size-3.5' aria-hidden='true' />{t('approval.edit')}
                </button>
              )
            ) : null}
          </div>
          <div className='flex flex-col gap-2.5 p-3'>
            {fields.map((field) => {
              const value = values[field.key] ?? '';
              if (editing) {
                return (
                  <label key={field.key} className='flex flex-col gap-1'>
                    <span className='text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>{field.label}</span>
                    {field.multiline
                      ? <Textarea value={value} disabled={send.isPending} className='min-h-[120px] resize-y bg-background leading-relaxed' onChange={(e) => setValues((p) => ({ ...p, [field.key]: e.target.value }))} />
                      : <Input value={value} disabled={send.isPending} className='bg-background' onChange={(e) => setValues((p) => ({ ...p, [field.key]: e.target.value }))} />}
                  </label>
                );
              }
              if (field.multiline) {
                return (
                  <div key={field.key} className='break-words text-sm leading-relaxed'>
                    {value
                      ? (field.markdown
                          ? <div className='space-y-2 [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5'><ReactMarkdown>{value}</ReactMarkdown></div>
                          : <p className='whitespace-pre-wrap'>{value}</p>)
                      : <span className='text-muted-foreground'>—</span>}
                  </div>
                );
              }
              return (
                <p key={field.key} className='flex flex-wrap gap-x-2 text-sm'>
                  <span className='shrink-0 text-muted-foreground'>{field.label} :</span>
                  <span className='min-w-0 break-words font-medium'>{value || '—'}</span>
                </p>
              );
            })}
          </div>
        </div>
      ) : null}
    </article>
  );
}
