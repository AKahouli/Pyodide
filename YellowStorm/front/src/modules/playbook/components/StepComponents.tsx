import { AIMessageContent } from '@/components/ai-elements/ai-message-content';
import { MessageProvider } from '@/components/ai-elements/message-context';
import { mapComponentsToContentParts } from '@/modules/conversation/utils';
import type { MessageComponent } from '@/modules/conversation/types';
import type { HumanFeedbackData, PlaybookComponent } from '../types';
import { HumanFeedbackInline } from './HumanFeedbackInline';
import { PlaybookArtifactActions } from './PlaybookArtifactActions';

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
  executionId,
}: {
  components: PlaybookComponent[];
  taskId: string;
  executionId?: string;
}) {
  const visibleComponents = dedupeMirroredTextComponents(components);
  const groups: Array<{ type: 'ai'; items: MessageComponent[] } | { type: 'hf'; data: HumanFeedbackData } | { type: 'artifact'; data: Record<string, unknown> }> = [];

  let currentAiGroup: MessageComponent[] = [];
  for (const comp of visibleComponents) {
    if (comp.type === 'humanFeedback' || comp.type === 'artifact') {
      if (currentAiGroup.length > 0) {
        groups.push({ type: 'ai', items: currentAiGroup });
        currentAiGroup = [];
      }
      if (comp.type === 'humanFeedback') groups.push({ type: 'hf', data: comp.data as unknown as HumanFeedbackData });
      else groups.push({ type: 'artifact', data: comp.data as Record<string, unknown> });
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
        ) : group.type === 'hf' ? (
          <HumanFeedbackInline key={i} data={group.data} taskId={taskId} />
        ) : executionId && typeof group.data.artifactId === 'string' ? (
          <PlaybookArtifactActions key={i} card executionId={executionId} artifactId={group.data.artifactId} filename={String(group.data.filename || 'artifact')} mimeType={String(group.data.mimeType || '')} />
        ) : (
          <AIMessageContent key={i} parts={mapComponentsToContentParts([{ type: 'artifact', data: group.data } as MessageComponent])} />
        ),
      )}
    </MessageProvider>
  );
}
