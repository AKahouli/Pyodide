import { AIMessageContent } from '@/components/ai-elements/ai-message-content';
import { MessageProvider } from '@/components/ai-elements/message-context';
import { mapComponentsToContentParts } from '@/modules/conversation/utils';
import type { MessageComponent } from '@/modules/conversation/types';
import type { HumanFeedbackData, PlaybookComponent } from '../types';
import { HumanFeedbackInline } from './HumanFeedbackInline';

function dedupeMirroredTextComponents(components: PlaybookComponent[]): PlaybookComponent[] {
  const syntheticTexts = components.filter(
    (c) =>
      c.type === 'text' &&
      String((c as { id?: string }).id || '').startsWith('playbook-final-text-'),
  );
  if (syntheticTexts.length === 0) return components;

  const syntheticContents = new Set(
    syntheticTexts.map((c) => String((c.data as { content?: string })?.content || '').trim()),
  );

  return components.filter((c) => {
    if (c.type !== 'text') return true;
    if (String((c as { id?: string }).id || '').startsWith('playbook-final-text-')) return true;
    return !syntheticContents.has(String((c.data as { content?: string })?.content || '').trim());
  });
}

export function StepComponents({
  components,
  taskId,
}: {
  components: PlaybookComponent[];
  taskId: string;
}) {
  const visibleComponents = dedupeMirroredTextComponents(components);
  const groups: Array<{ type: 'ai'; items: MessageComponent[] } | { type: 'hf'; data: HumanFeedbackData }> = [];

  let currentAiGroup: MessageComponent[] = [];
  for (const comp of visibleComponents) {
    if (comp.type === 'humanFeedback') {
      if (currentAiGroup.length > 0) {
        groups.push({ type: 'ai', items: currentAiGroup });
        currentAiGroup = [];
      }
      groups.push({ type: 'hf', data: comp.data as unknown as HumanFeedbackData });
    } else {
      currentAiGroup.push(comp as MessageComponent);
    }
  }
  if (currentAiGroup.length > 0) {
    groups.push({ type: 'ai', items: currentAiGroup });
  }

  return (
    <MessageProvider fileViewerDisplayMode="floating">
      {groups.map((group, i) =>
        group.type === 'ai' ? (
          <AIMessageContent key={i} parts={mapComponentsToContentParts(group.items)} />
        ) : (
          <HumanFeedbackInline key={i} data={group.data} taskId={taskId} />
        ),
      )}
    </MessageProvider>
  );
}
