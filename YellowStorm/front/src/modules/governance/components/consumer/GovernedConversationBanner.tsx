import { ShieldCheck } from 'lucide-react';
import type { Conversation } from '@/modules/conversation/types';
import { useModuleTranslation } from '@/modules/localization';

export function GovernedConversationBanner({ conversation }: Readonly<{ conversation: Conversation }>): JSX.Element | null {
  const { t } = useModuleTranslation('conversation');
  if (conversation.runtimeMode !== 'governed' || !conversation.governanceContext) return null;
  return <div className='mx-4 mt-3 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3'><ShieldCheck className='mt-0.5 size-5 shrink-0 text-primary' /><div><div className='text-sm font-semibold'>{t('governedConversation.title')}</div><div className='text-sm text-muted-foreground'>{t('governedConversation.version', { number: conversation.governanceContext.revisionNumber })}</div><div className='mt-0.5 text-xs text-muted-foreground'>{t('governedConversation.description')}</div></div></div>;
}
