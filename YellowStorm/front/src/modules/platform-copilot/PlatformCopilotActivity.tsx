import { AssistantActivity } from '@/components/ai-elements/assistant-response';
import { useModuleTranslation } from '@/modules/localization';
import type { MessageComponent } from '@/modules/conversation/types';

export function PlatformCopilotActivity({ components, isStreaming }: Readonly<{ components: readonly MessageComponent[]; isStreaming: boolean }>) {
  const { t } = useModuleTranslation('platform-copilot');
  return (
    <AssistantActivity
      components={components}
      isStreaming={isStreaming}
      labels={{
        title: t('activity.title'),
        reasoning: t('activity.reasoning'),
        status: {
          running: t('activity.status.running'),
          completed: t('activity.status.completed'),
          failed: t('activity.status.failed'),
          pending: t('activity.status.pending'),
        },
      }}
    />
  );
}
