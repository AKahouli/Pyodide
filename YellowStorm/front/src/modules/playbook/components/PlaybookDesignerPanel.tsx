import { useEffect, useRef, useState, useCallback, type FormEvent } from 'react';
import { X, Send, RotateCcw, AlertCircle, Sparkles, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useModuleTranslation } from '@/modules/localization';
import {
  usePlaybookStore,
  useDesignMessages,
  useDesignMessagesLoading,
  useIsDesigning,
  useDesignerOpen,
} from '../store';
import { useAutosave } from '../hooks/useAutosave';
import { useIsDirty } from '../store';

interface Props {
  playbookId: string | undefined;
}

export function PlaybookDesignerPanel({ playbookId }: Props) {
  const { t } = useModuleTranslation('playbook');

  const designerOpen = useDesignerOpen();
  const messages = useDesignMessages();
  const messagesLoading = useDesignMessagesLoading();
  const isDesigning = useIsDesigning();
  const isDirty = useIsDirty();

  const fetchDesignMessages = usePlaybookStore((s) => s.fetchDesignMessages);
  const designPlaybook = usePlaybookStore((s) => s.designPlaybook);
  const revertToSnapshot = usePlaybookStore((s) => s.revertToSnapshot);
  const setDesignerOpen = usePlaybookStore((s) => s.setDesignerOpen);

  const { saveNow } = useAutosave();

  const [query, setQuery] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevMessageCount = useRef(messages.length);

  // Fetch messages when panel opens
  useEffect(() => {
    if (designerOpen && playbookId) {
      fetchDesignMessages(playbookId);
    }
  }, [designerOpen, playbookId, fetchDesignMessages]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > prevMessageCount.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
    prevMessageCount.current = messages.length;
  }, [messages.length]);

  const handleSubmit = useCallback(async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim() || !playbookId || isDesigning) return;

    const q = query.trim();
    setQuery('');

    if (isDirty) await saveNow();

    try {
      await designPlaybook(playbookId, { query: q });
    } catch {
      // handled in store
    }
  }, [query, playbookId, isDesigning, isDirty, saveNow, designPlaybook]);

  const handleRevert = useCallback(async (messageId: string) => {
    if (!playbookId) return;
    try {
      await revertToSnapshot(playbookId, messageId);
    } catch {
      // handled in store
    }
  }, [playbookId, revertToSnapshot]);

  return (
    <div
      className="absolute right-0 inset-y-0 w-80 sm:w-96 z-40 border-l bg-background flex flex-col transition-transform duration-300"
      style={{ transform: designerOpen ? 'translateX(0)' : 'translateX(100%)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <h3 className="text-sm font-semibold">{t('designer.title')}</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDesignerOpen(false)}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-3">
        {messages.length === 0 && !messagesLoading && (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground px-4">
            <Sparkles className="h-8 w-8 mb-3 opacity-40" />
            <p className="text-sm font-medium">{t('designer.empty')}</p>
            <p className="text-xs mt-1">{t('designer.emptyHint')}</p>
          </div>
        )}

        {messages.map((msg) => {
          // Reverted: system pill centered in timeline
          if (msg.status === 'reverted') {
            return (
              <div key={msg.id} className="flex justify-center">
                <div className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-muted-foreground bg-background">
                  <Undo2 className="h-3 w-3" />
                  <span>{t('designer.revertedLabel')}</span>
                  <span className="text-muted-foreground/60">
                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            );
          }

          return (
            <div key={msg.id} className="space-y-2">
              {/* User bubble */}
              <div className="flex justify-end">
                <div className="bg-primary text-primary-foreground rounded-lg rounded-tr-sm px-3 py-2 max-w-[85%] text-sm">
                  {msg.userQuery}
                </div>
              </div>

              {/* AI response */}
              <div className="flex justify-start">
                <div className="bg-muted rounded-lg rounded-tl-sm px-3 py-2 max-w-[85%] space-y-1.5">
                  {msg.status === 'failed' ? (
                    <div className="flex items-center gap-1.5 text-destructive text-xs">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      <span>{msg.error || t('designer.failed')}</span>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm">{msg.aiSummary}</p>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">
                          {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => handleRevert(msg.id)}
                        >
                          <RotateCcw className="h-3 w-3 mr-1" />
                          {t('designer.revert')}
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {isDesigning && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg rounded-tl-sm px-3 py-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className="flex gap-0.5">
                  {[0, 0.2, 0.4].map((delay, i) => (
                    <span
                      key={i}
                      className="inline-block w-1.5 h-1.5 rounded-full bg-muted-foreground animate-pulse"
                      style={{ animationDelay: `${delay}s` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <form className="border-t px-3 py-3 flex gap-2 shrink-0" onSubmit={handleSubmit}>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('designer.inputPlaceholder')}
          disabled={isDesigning}
          className="text-sm"
        />
        <Button type="submit" size="icon" disabled={!query.trim() || isDesigning} className="shrink-0">
          <Send className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
