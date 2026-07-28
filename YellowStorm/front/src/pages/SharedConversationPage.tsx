import { useEffect, useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Loader2, ExternalLink } from 'lucide-react';
import { ChatConversation, ChatConversationContent, ChatMessageBubble } from '@/components/ai-elements/chat-conversation';
import { MessageProvider } from '@/components/ai-elements/message-context';
import { Button } from '@/components/ui/button';
import { viewPublicShare } from '@/modules/conversation/api';
import { mapConversationComponentsToContentParts } from '@/modules/conversation/utils';
import type { PublicShareViewResponse, PublicShareMessage } from '@/modules/conversation/types';
import { useModuleTranslation } from '@/modules/localization';

function ShareMessageBubble({ message, index }: { message: PublicShareMessage; index: number }) {
  const chatMessage = useMemo(() => {
    if (!message) return null;
    const isUser = message.conversationType === 'user';

    let content: string | ReturnType<typeof mapConversationComponentsToContentParts>;
    if (isUser) {
      content = message.content || '';
    } else {
      // For AI messages, try components first, fall back to content string
      content = message.components !== undefined
        ? mapConversationComponentsToContentParts(message.components)
        : message.content || '';
    }

    return {
      id: `share-msg-${index}`,
      role: isUser ? 'user' : 'assistant',
      content,
      timestamp: message.createdAt ? new Date(message.createdAt) : undefined,
    } as const;
  }, [message, index]);

  if (!chatMessage || (chatMessage.role === 'assistant' && Array.isArray(chatMessage.content) && chatMessage.content.length === 0)) return null;

  return (
    <MessageProvider isLastAiMessage={false} isStreaming={false}>
      <ChatMessageBubble message={chatMessage} showTaskDiagnostics={false} />
    </MessageProvider>
  );
}

export function SharedConversationPage() {
  const { accessToken } = useParams<{ accessToken: string }>();
  const [share, setShare] = useState<PublicShareViewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { t, language } = useModuleTranslation('common');
  const loadErrorMessage = useMemo(
    () => t('share.loadError', { defaultValue: 'Failed to load the shared conversation.' }),
    [t],
  );

  useEffect(() => {
    async function loadShare() {
      if (!accessToken) return;
      try {
        const data = await viewPublicShare(accessToken);
        setShare(data);
      } catch (err: unknown) {
        if (err instanceof Error) {
          setError(err.message);
        } else {
          setError(loadErrorMessage);
        }
      } finally {
        setIsLoading(false);
      }
    }
    loadShare();
  }, [accessToken, loadErrorMessage]);

  if (isLoading) {
    return (
      <div className='flex items-center justify-center min-h-screen'>
        <Loader2 className='h-8 w-8 animate-spin text-muted-foreground' />
      </div>
    );
  }

  if (error || !share) {
    return (
      <div className='flex flex-col items-center justify-center min-h-screen gap-4'>
        <h1 className='text-2xl font-bold'>{t('share.notFound.title', { defaultValue: 'Conversation not found' })}</h1>
        <p className='text-muted-foreground text-center max-w-md'>
          {error ||
            t('share.notFound.description', {
              defaultValue: 'We could not find that shared conversation or it may have expired.',
            })}
        </p>
        <Button asChild variant='outline'>
          <Link to='/'>{t('share.notFound.cta', { defaultValue: 'Back to app' })}</Link>
        </Button>
      </div>
    );
  }

  const viewCount = share.viewCount ?? 0;
  const formattedViewCount = new Intl.NumberFormat(language).format(viewCount);
  const formattedDate = new Intl.DateTimeFormat(language).format(new Date(share.createdAt));

  return (
    <div className='min-h-screen flex flex-col'>
      {/* Header */}
      <header className='border-b bg-background/95 backdrop-blur sticky top-0 z-10'>
        <div className='max-w-3xl mx-auto px-4 py-4 flex items-center justify-between'>
          <div>
            <h1 className='text-lg font-semibold'>{share.title}</h1>
            <p className='text-sm text-muted-foreground'>
              {t('share.header.subtitle', {
                formattedCount: formattedViewCount,
                defaultValue: 'Shared {{formattedCount}} times',
              })}
            </p>
          </div>
          <Button asChild variant='outline' size='sm'>
            <Link to='/'>
              <ExternalLink className='h-4 w-4 mr-2' />
              {t('share.header.openApp', { defaultValue: 'Open app' })}
            </Link>
          </Button>
        </div>
      </header>

      {/* Messages */}
      <main className='flex-1'>
        <ChatConversation className='max-w-3xl mx-auto'>
          <ChatConversationContent className='py-6'>
            {(share.messages || []).filter(Boolean).map((message, index) => (
              <ShareMessageBubble key={index} message={message} index={index} />
            ))}
          </ChatConversationContent>
        </ChatConversation>
      </main>

      {/* Footer */}
      <footer className='border-t py-4 text-center text-sm text-muted-foreground'>
        {t('share.footer.sharedOn', { date: formattedDate, defaultValue: 'Shared on {{date}}' })}
      </footer>
    </div>
  );
}
