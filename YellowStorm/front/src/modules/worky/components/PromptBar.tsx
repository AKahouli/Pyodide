import { Send, Square } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useModuleTranslation } from '@/modules/localization';
import { useSendMessage } from '../query/hooks';
import { useWorkyStreaming } from '../store';

interface PromptBarProps {
  streamId: string;
}

export function PromptBar({ streamId }: PromptBarProps): JSX.Element {
  const { t } = useModuleTranslation('worky');
  const [value, setValue] = useState('');
  const send = useSendMessage(streamId);
  const streaming = useWorkyStreaming();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim() || send.isPending) return;
    send.mutate(value.trim(), {
      onSuccess: () => setValue(''),
    });
  };

  return (
    <form
      className='flex items-center gap-2 border-t border-border/60 bg-background/40 px-4 py-3'
      onSubmit={submit}
    >
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={t('promptBar.placeholder')}
        rows={1}
        disabled={send.isPending}
        className='min-h-[40px] flex-1 resize-none rounded-md border border-border/60 bg-background/60 px-3 py-2 text-sm placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60'
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit(e);
          }
        }}
      />
      <Button
        type='submit'
        size='icon'
        disabled={send.isPending || !value.trim()}
        aria-label={streaming ? t('promptBar.streaming') : t('promptBar.send')}
      >
        {streaming ? <Square className='h-4 w-4' /> : <Send className='h-4 w-4' />}
      </Button>
    </form>
  );
}
