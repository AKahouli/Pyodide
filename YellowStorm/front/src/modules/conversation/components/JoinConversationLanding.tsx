import { Users, ArrowRight, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import type { Conversation } from '../types';

interface JoinConversationLandingProps {
  conversation: Conversation;
  onJoin: () => void;
  loading?: boolean;
}

export function JoinConversationLanding({ conversation, onJoin, loading }: JoinConversationLandingProps) {
  const { t } = useModuleTranslation('conversation');

  const members = conversation.groupMeta?.members || [];
  const invitedUsers = conversation.groupMeta?.invitedUsers || [];

  const ownerName = conversation.ownerName || t('joinLanding.groupLabel');

  return (
    <div className='relative flex flex-1 flex-col items-center justify-center'>

      <div className='animate-fade-up relative w-full max-w-lg text-center'>
        <div className='mx-auto mb-8 flex h-24 w-24 items-center justify-center rounded-3xl bg-primary/10 text-primary'>
          <Users className='h-12 w-12' />
        </div>

        <h1 className='text-4xl font-bold tracking-tight text-white mb-4'>
          {conversation.title || t('joinLanding.defaultTitle')}
        </h1>

        <p className='text-slate-400 text-lg mb-12 max-w-md mx-auto'>
          {t('joinLanding.invitedBy')} <span className='text-primary font-semibold'>{ownerName}</span>
        </p>

        <div className='flex flex-col gap-4 w-full max-w-sm mx-auto'>
          <Button
            onClick={onJoin}
            disabled={loading}
            size='lg'
            className='w-full h-14 text-lg font-bold bg-primary hover:bg-primary/90 text-primary-foreground rounded-2xl transition-all active:scale-[0.98]'
          >
            {loading ? (
              <span className='flex items-center gap-2'>
                <div className='h-5 w-5 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent' />
                {t('page.loading')}
              </span>
            ) : (
              <span className='flex items-center gap-2'>
                {t('joinLanding.joinButton')}
                <ArrowRight className='h-5 w-5' />
              </span>
            )}
          </Button>

          <div className='flex items-center justify-center gap-2 text-slate-500 text-sm'>
            <ShieldCheck className='h-4 w-4' />
            {invitedUsers.length} {t('joinLanding.participants').toLowerCase()}
          </div>
        </div>
      </div>
    </div>
  );
}
