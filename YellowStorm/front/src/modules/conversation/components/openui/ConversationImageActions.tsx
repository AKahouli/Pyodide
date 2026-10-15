import { useCallback, useContext, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getActiveConnectors, getActiveTools } from '@/modules/agent/api';
import { useAgentStore } from '@/modules/agent/store';
import { useModuleTranslation } from '@/modules/localization';
import { useConversationStore } from '../../store';
import { OpenUiCitationContext, type OpenUiCitationScope } from './citations';
import { ImageActionToolbar } from './ImageActionToolbar';

export function ConversationImageActions({ source, alt, scope, url, streaming, peers = [], resolveImage }: {
  source: string; alt: string; scope: OpenUiCitationScope; url?: string; streaming?: boolean;
  peers?: { source: string; label: string }[]; resolveImage: (source: string) => Promise<Blob>;
}) {
  const { t } = useModuleTranslation('conversation');
  const conversation = useConversationStore((state) => state.currentConversation);
  const isStreaming = useConversationStore((state) => state.isStreaming);
  const messages = useConversationStore((state) => state.messages);
  const agents = useAgentStore((state) => state.agents);
  const initialized = useAgentStore((state) => state.isInitialized);
  const directoryError = useAgentStore((state) => state.error);
  const { byReference } = useContext(OpenUiCitationContext);
  const enabled = conversation?.id === scope.conversationId && conversation.runtimeMode !== 'governed';
  const message = messages.find((candidate) => candidate.id === scope.messageId && candidate.conversationId === scope.conversationId);
  const sourceParts = message?.components?.filter((component) => component.type === 'text' && typeof component.data.content === 'string' && component.data.content.includes(source)) ?? [];
  const owningText = scope.componentId ? sourceParts.find((component) => component.id === scope.componentId)
    : sourceParts.length === 1 ? sourceParts[0] : undefined;
  const explicitOwner = owningText?.data.actorId ?? owningText?.data.agentId;
  const producerIds = [...new Set((message?.components ?? []).filter((component) => ['text', 'agentActivity'].includes(component.type))
    .map((component) => component.data.actorId ?? component.data.agentId).filter((id): id is string => typeof id === 'string' && Boolean(id)))];
  // Missing part identity may only fall back when both source and producer are
  // unambiguous. A shared [1] marker must never select another agent's image.
  const fallbackOwner = producerIds.length === 1 ? producerIds[0] : !producerIds.length && message?.agentIds?.length === 1 ? message.agentIds[0]
    : !producerIds.length && !message?.agentIds?.length ? conversation?.rootAgentId || conversation?.pinnedAgentId || (conversation?.taggedAgentIds?.length === 1 ? conversation.taggedAgentIds[0] : undefined) : undefined;
  const agentId = owningText ? typeof explicitOwner === 'string' ? explicitOwner : fallbackOwner : undefined;
  const agent = agents.find((candidate) => candidate.id === agentId);
  const capabilities = useQuery({
    queryKey: ['conversation-image-action-capabilities'],
    queryFn: async () => { const [tools, connectors] = await Promise.all([getActiveTools(), getActiveConnectors()]); return { tools, connectors }; },
    enabled: Boolean(enabled), staleTime: 60_000, retry: false,
  });
  useEffect(() => { if (enabled && !initialized) void useAgentStore.getState().fetchAgents().catch(() => undefined); }, [enabled, initialized]);
  const imageTool = capabilities.data?.tools.find((tool) => tool.name === 'generate_image');
  const interpreter = capabilities.data?.connectors.find((connector) => {
    if (!agent?.connectors?.includes(connector.id)) return false;
    const selected = agent.connectorActionSelections?.find((selection) => selection.connectorId === connector.id)?.actionKeys;
    const actions = (connector.actions ?? []).filter((action) => action.isEnabled && (!selected || selected.includes(action.key)))
      .map((action) => action.key.split(/[:./]/).at(-1));
    return actions.includes('send_file_to_user') && (actions.includes('python_exec') || actions.includes('shell_exec'));
  });
  const citation = /^\[(\d+)\]$/.exec(source)?.[1];
  const document = citation ? byReference.get(citation) : undefined;
  const canEdit = Boolean(enabled && !capabilities.isError && !directoryError && agent?.isActive && imageTool && agent.tools.includes(imageTool.id)
    && (!citation || document?.fileName?.trim()));
  const canReuse = Boolean(canEdit && interpreter && agent?.connectors?.includes(interpreter.id));
  const requestSource = document?.fileName || source;
  const sourcePage = document?.page ? Number(document.page.match(/\d+/g)?.at(-1) ?? 1) : undefined;
  const pdfPageNotice = document && /\.pdf$/i.test(document.fileName || document.source)
    ? t('openui.image.actions.pdfPageNotice', { page: sourcePage ?? 1 }) : undefined;
  const savedImages = useMemo(() => {
    const found = new Map<string, string>();
    for (const message of messages) {
      if (message.conversationId !== scope.conversationId || message.conversationType !== 'ai') continue;
      const text = [message.content, ...(message.components ?? []).map((component) => component.data.content)].join('\n');
      for (const match of text.matchAll(/generated-image:[a-f\d]{24}/g)) found.set(match[0], message.id);
    }
    return found;
  }, [messages, scope.conversationId]);
  const comparisonPeers = [...new Map([...peers, ...[...savedImages.keys()].map((image, index) => ({ source: image, label: t('openui.image.actions.savedImage', { index: index + 1 }) }))].map((entry) => [entry.source, entry])).values()];
  const resolveComparisonImage = useCallback(async (imageSource: string) => {
    const owner = savedImages.get(imageSource);
    if (owner && owner !== scope.messageId) {
      const { loadGeneratedImage } = await import('./document-images');
      return loadGeneratedImage(imageSource, { conversationId: scope.conversationId, messageId: owner });
    }
    return resolveImage(imageSource);
  }, [savedImages, scope.conversationId, scope.messageId, resolveImage]);
  const resolveAspectRatio = useCallback(async () => {
    const blob = await resolveComparisonImage(source);
    if (!blob.type.startsWith('image/') || blob.size > 20 * 1024 * 1024) throw new Error('Invalid image');
    const image = await createImageBitmap(blob);
    try {
      if (!image.width || !image.height) throw new Error('Invalid image dimensions');
      return image.width > image.height ? 'landscape' as const : image.height > image.width ? 'portrait' as const : 'square' as const;
    } finally { image.close(); }
  }, [source, resolveComparisonImage]);
  const onSend = useCallback(async (content: string) => {
    const state = useConversationStore.getState();
    if (!canEdit || !agentId || state.currentConversation?.id !== scope.conversationId || state.currentConversation.runtimeMode === 'governed' || state.isStreaming) throw new Error('Image action unavailable');
    await state.sendMessage(scope.conversationId, { content, agentIds: [agentId], parentMessageId: scope.messageId,
      ...(message?.modelId ? { modelId: message.modelId } : {}) });
  }, [canEdit, agentId, scope.conversationId, scope.messageId, message?.modelId]);
  return <div data-html2canvas-ignore='true' data-openui-image-actions=''>
    {pdfPageNotice && <p className='text-xs text-muted-foreground'>{pdfPageNotice}</p>}
    <ImageActionToolbar source={source} requestSource={requestSource} sourcePage={sourcePage} sourceNotice={pdfPageNotice} connectorName={interpreter?.slug || interpreter?.name} alt={alt} scope={scope}
      url={url} streaming={streaming || isStreaming || !enabled} canEdit={canEdit} canReuse={canReuse} canReuseSlides={canEdit}
      peers={comparisonPeers} resolveImage={resolveComparisonImage} resolveAspectRatio={resolveAspectRatio} onSend={onSend} />
    {(capabilities.isError || directoryError || (enabled && initialized && !agent)) && <p role='status' className='text-xs text-muted-foreground'>{t('openui.image.actions.unavailable')}</p>}
  </div>;
}
