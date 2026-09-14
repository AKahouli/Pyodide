import { Globe2 } from 'lucide-react';
import { PromptInputButton } from '@/components/ai-elements/prompt-input';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import { useSetWebConnectorAccessEnabled, useWebConnectorAccessEnabled } from '../store';

export function WebSearchConnectorToggle() {
  const { t } = useModuleTranslation('conversation');
  const enabled = useWebConnectorAccessEnabled();
  const setEnabled = useSetWebConnectorAccessEnabled();

  return (
    <PromptInputButton
      type='button'
      variant='outline'
      onClick={() => setEnabled(!enabled)}
      className={cn('rounded-full px-2.5', enabled && 'border-primary bg-primary/10 text-primary')}
      title={t('input.webSearch')}
      aria-label={t('input.webSearch')}
      aria-pressed={enabled}
    >
      <Globe2 className='size-4' aria-hidden='true' />
      <span>{t('input.webSearch')}</span>
    </PromptInputButton>
  );
}
