import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bot, Loader2, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { AgentComposer } from '@/modules/conversation-v2/components/AgentComposer';
import { startConversationV2AgentSession } from '@/modules/conversation-v2/startAgentSession';
import { useConversationV2Store } from '@/modules/conversation-v2/store';

const SUGGESTION_KEYS = ['dashboard', 'tasks', 'form'] as const;

/**
 * Compact Agent entry point on App Builder. Reuses conversation-v2 AgentComposer
 * + startConversationV2AgentSession so NodePod / SSE / RightPanel stay on the
 * session page after navigate.
 */
export function AppBuilderCreateWithAgent() {
  const { t } = useModuleTranslation('app-builder');
  const navigate = useNavigate();
  const [isSending, setIsSending] = useState(false);
  const [prefillText, setPrefillText] = useState('');
  const [prefillNonce, setPrefillNonce] = useState(0);

  useEffect(() => {
    useConversationV2Store.getState().setSelectedSkillIds([]);
    useConversationV2Store.getState().setSelectedConnectorIds([]);
  }, []);

  const handleSubmit = async (
    message: PromptInputMessage,
    workspaceIds: string[],
    modelId: string | null,
  ) => {
    const text = message.text?.trim() ?? '';
    if (!text || isSending) return;
    setIsSending(true);
    try {
      await startConversationV2AgentSession({
        text,
        workspaceIds,
        modelId,
        navigate,
        source: 'app-builder',
      });
    } catch {
      toast.error(t('createWithAgent.error'));
    } finally {
      setIsSending(false);
    }
  };

  const applySuggestion = (text: string) => {
    setPrefillText(text);
    setPrefillNonce((n) => n + 1);
  };

  return (
    <section
      className={cn(
        'relative overflow-hidden rounded-2xl border border-border/60',
        'bg-card/50 shadow-sm',
        'before:pointer-events-none before:absolute before:inset-0 before:bg-gradient-to-br',
        'before:from-sky-500/[0.07] before:via-transparent before:to-transparent',
      )}
      aria-labelledby='app-builder-create-heading'
      aria-busy={isSending}
    >
      <div className='relative space-y-4 p-4 sm:p-5'>
        <div className='flex gap-3 sm:gap-4'>
          <div
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
              'bg-sky-500/12 text-sky-700 dark:bg-sky-500/25 dark:text-sky-300',
            )}
            aria-hidden
          >
            <Bot className='h-5 w-5' />
          </div>
          <div className='min-w-0 flex-1 pt-0.5'>
            <p className='text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground'>
              {t('createWithAgent.eyebrow')}
            </p>
            <h2
              id='app-builder-create-heading'
              className='mt-0.5 text-base font-semibold tracking-tight sm:text-lg'
            >
              {t('createWithAgent.title')}
            </h2>
            <p className='mt-1 max-w-2xl text-sm leading-relaxed text-muted-foreground'>
              {t('createWithAgent.description')}
            </p>
          </div>
        </div>

        <div
          className={cn(
            'rounded-xl border border-border/70 bg-background/90 p-2.5 sm:p-3',
            'ring-1 ring-border/40 transition-[box-shadow,border-color] duration-200',
            'focus-within:border-sky-500/40 focus-within:ring-2 focus-within:ring-sky-500/20',
            isSending && 'pointer-events-none opacity-70',
          )}
        >
          <AgentComposer
            onSubmit={handleSubmit}
            disabled={isSending}
            placeholder={t('createWithAgent.placeholder')}
            prefillText={prefillText}
            prefillNonce={prefillNonce}
          />
        </div>

        <div className='flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between'>
          <div className='min-w-0'>
            <p className='mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground'>
              <Sparkles className='h-3 w-3 shrink-0' aria-hidden />
              {t('createWithAgent.suggestions.label')}
            </p>
            <div className='flex flex-wrap gap-1.5' role='list'>
              {SUGGESTION_KEYS.map((key) => {
                const label = t(`createWithAgent.suggestions.${key}`);
                return (
                  <button
                    key={key}
                    type='button'
                    role='listitem'
                    disabled={isSending}
                    onClick={() => applySuggestion(label)}
                    className={cn(
                      'max-w-full truncate rounded-full border border-border/70 bg-background/80',
                      'px-2.5 py-1 text-left text-xs text-foreground/90',
                      'transition-colors hover:border-sky-500/35 hover:bg-sky-500/8',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/35',
                      'disabled:pointer-events-none disabled:opacity-50',
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {isSending ? (
            <p className='inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground'>
              <Loader2 className='h-3.5 w-3.5 animate-spin' aria-hidden />
              {t('createWithAgent.sending')}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
