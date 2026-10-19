import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ThumbsUp, ThumbsDown, Copy, RotateCcw, MoreHorizontal, FileText, Flag, GitBranch, Loader2, Workflow, BookOpen, Globe, Share2, FileDown } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { useModuleTranslation } from '@/modules/localization';
import { showSuccess, showError } from '@/lib/notifications';
import { useConversationStore } from '../store';
import { closeConversationContextPanel } from '../uiStore';
import { componentsToMarkdown, mapConversationComponentsToContentParts } from '../utils';
import { createOpenUiTextProjector, isOpenUiProgram } from './openui/plain-text';
import { collectMessageCitations, getCitationEntryLabel, isUrlCitation } from '../utils/message-citations';
import { buildExportFilename, buildMcpExportManifest, buildStructuredExportBlocks, fetchAllMessagesForExport } from '../utils/document-export';
import { resolveOpenUiExportImage } from '../utils/openui-export-assets';
import { persistMcpExportImages } from '../utils/mcp-export-images';
import { downloadBlob, exportBlocksToDocx } from '../utils/docx-export';
import { exportBlocksToHtml, exportUrlTransform } from '../utils/html-export';
import { openCitationSource, type CitationData } from '@/components/ai-elements/ai-message-content';
import { useFileViewerDisplayMode } from '@/components/ai-elements/message-context';
import type { DisplayedAnswerVersion, Message } from '../types';
import { ReportDialog } from './ReportDialog';
import { TimingIndicator } from './TimingIndicator';
import { usePermissions } from '@/modules/admin/hooks/usePermissions';
import { useAuth } from '@/modules/auth';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PdfExportPortal } from './PdfExportPortal';
import { useNavigate } from 'react-router-dom';
import { useApiAction } from '@/lib/use-api-action';
import { branchConversation, prepareConversationPlaybookHandoff, fetchMessages } from '../api';
import { useModelById } from '@/modules/models';
import { useFeatureVisibilityStore } from '@/modules/admin/featureVisibilityStore';
import { usePlatformCopilotPanelStore } from '@/modules/platform-copilot/platformCopilotPanelStore';

import { cn } from '@/lib/utils';
import { formatCarbon, formatCompactTokenTotal, formatUsd } from '../utils/usage-format';

interface MessageActionsProps {
  message: Message;
  isLastAiMessage: boolean;
  conversationId: string;
  displayedVersion?: DisplayedAnswerVersion;
  className?: string;
  latencyInstrumentationEnabled?: boolean;
}

export const MessageActions = memo(function MessageActions({ message, isLastAiMessage, conversationId, displayedVersion = 'original', className, latencyInstrumentationEnabled }: MessageActionsProps) {
  const { user } = useAuth();
  const exportActor = useRef(user?.id); exportActor.current = user?.id;
  const updateFeedback = useConversationStore((s) => s.updateFeedback);
  const regenerateMessage = useConversationStore((s) => s.regenerateMessage);
  const setReplyingToMessage = useConversationStore((s) => s.setReplyingToMessage);
  const currentConversation = useConversationStore((s) => s.currentConversation);
  const messages = useConversationStore((s) => s.messages);
  const conversationUsage = useConversationStore((s) => s.conversationUsage);
  const activeBranches = useConversationStore((s) => s.activeBranches);
  const fetchConversations = useConversationStore((s) => s.fetchConversations);
  const currentConversationId = useConversationStore((s) => s.currentConversationId);
  const sendMessage = useConversationStore((s) => s.sendMessage);
  const conversationBusy = useConversationStore((s) => s.isStreaming || s.isAwaitingFirstChunk || Object.values(s.liveAnswers ?? {}).some((answer) => answer.conversationId === conversationId));
  const isGroup = !!currentConversation?.groupMeta?.isGroup;
  const [reportOpen, setReportOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const handoffCreationRequest = useRef<{
    fingerprint: string;
    requestId: string;
  }>();
  const openHandoff = usePlatformCopilotPanelStore((state) => state.openHandoff);
  const playbookMcpAssistant = useFeatureVisibilityStore((state) => state.visibility.playbookMcpAssistant);
  const platformCopilotEnabled = useFeatureVisibilityStore((state) => state.visibility.platformCopilot);
  const { canUseFeature } = usePermissions();
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingDocx, setIsExportingDocx] = useState(false);
  const [isExportingViaAgent, setIsExportingViaAgent] = useState(false);
  const agentExportLock = useRef(false);
  const [exportMarkdown, setExportMarkdown] = useState('');
  const [pdfActor, setPdfActor] = useState<string>();
  useEffect(() => {
    exportActor.current = user?.id;
    setIsExportingPdf(false); setExportMarkdown(''); setPdfActor(undefined);
    return () => { exportActor.current = undefined; };
  }, [user?.id]);
  const { t, language } = useModuleTranslation('conversation');
  const { t: tCommon } = useModuleTranslation('common');
  const fileViewerDisplayMode = useFileViewerDisplayMode();
  const citations = useMemo(() => collectMessageCitations(message.components), [message.components]);
  const generationModelId = message.modelId || (message.questionMessageId ? messages.find((candidate) => candidate.id === message.questionMessageId)?.modelId : undefined);
  const model = useModelById(generationModelId || '');
  const reportedModel = useModelById(message.modelRequestTelemetry?.model || '');
  const navigate = useNavigate();
  const canBranch = !!currentConversation && message.isComplete && !message.isStreaming && !isGroup && currentConversation?.runtimeMode !== 'governed';
  const canExportViaAgent = currentConversationId === conversationId && message.isComplete && !message.isStreaming
    && currentConversation?.runtimeMode !== 'governed'
    && message.components?.some((component) => component.type === 'text' && isOpenUiProgram(component.data?.content));
  const { execute: createBranch, isLoading: isBranching } = useApiAction(branchConversation, {
    showSuccessToast: true,
    successMessage: t('toasts.branch.success'),
    onSuccess: (conversation) => {
      void fetchConversations({ reset: true });
      navigate(`/conversation/${conversation.id}`);
    },
  });
  const { execute: prepareHandoff, isLoading: isPreparingHandoff } = useApiAction(prepareConversationPlaybookHandoff, {
    onSuccess: (handoff) => {
      handoffCreationRequest.current = undefined;
      openHandoff(handoff);
    },
  });
  const canPrepareHandoff = playbookMcpAssistant && platformCopilotEnabled && canUseFeature('platformCopilot') && message.isComplete && !message.isStreaming;
  const createdAt = new Date(message.createdAt);
  const formattedCreatedAt = Number.isNaN(createdAt.getTime())
    ? t('messageActions.dateUnavailable')
    : new Intl.DateTimeFormat(language, {
        dateStyle: 'medium',
        timeStyle: 'medium',
      }).format(createdAt);
  const modelName = reportedModel?.name || message.modelRequestTelemetry?.model || model?.name || generationModelId || t('messageActions.modelUnavailable');
  const visibleUsage = isLastAiMessage ? conversationUsage : null;
  const formattedCost = formatUsd(visibleUsage?.cost.usd ?? null, language);
  const formattedCarbon = formatCarbon(visibleUsage?.carbon.gramsCo2e ?? null, language);

  const handleLike = () => {
    if (message.feedback === 'like') return;
    updateFeedback(conversationId, message.id, 'like');
  };

  const handleDislike = () => {
    if (message.feedback === 'dislike') return;
    updateFeedback(conversationId, message.id, 'dislike');
  };

  // OpenUI answers are stored as programs; copy and export their rendered text instead.
  const toMarkdown = useCallback(
    () => componentsToMarkdown(message.components || [], createOpenUiTextProjector(message.id, message.components || [])),
    [message.components, message.id],
  );

  const handleCopy = async () => {
    const markdown = toMarkdown();
    try {
      await navigator.clipboard.writeText(markdown);
      toast.success(t('toasts.message.copied'));
    } catch {
      toast.error(t('toasts.message.copyError'));
    }
  };

  const handleRegenerate = () => {
    regenerateMessage(conversationId, message.id);
  };

  const handleReply = () => {
    setReplyingToMessage(message);
  };

  const handleExportPdf = async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    setPdfActor(user?.id);
    try {
      const blocks = await buildAnswerExportBlocks();
      const markdown = blocks.map((block) => block.markdown).join('\n\n');
      if (!markdown.trim()) {
        setIsExportingPdf(false);
        showError(t('toasts.export.failed'));
        return;
      }
      setExportMarkdown(markdown);
    } catch {
      setIsExportingPdf(false);
      showError(t('toasts.export.failed'));
    }
  };

  const handlePdfExportFinish = (ok: boolean) => {
    setIsExportingPdf(false);
    setExportMarkdown('');
    if (!ok) toast.error(t('toasts.message.exportError'));
  };

  const exportTitle = currentConversation?.title?.trim() || t('exportPdf.untitledConversation');
  const savedExportMessages = () => message.components?.some(component => component.type === 'text' && isOpenUiProgram(component.data?.content))
    ? fetchAllMessagesForExport(conversationId, fetchMessages) : Promise.resolve(messages);
  const buildAnswerExportBlocks = async () => {
    const actorId = user?.id;
    const savedMessages = await savedExportMessages();
    const blocks = await buildStructuredExportBlocks([message],
      { user: t('export.userLabel'), assistant: t('export.assistantLabel') },
      () => formattedCreatedAt, resolveOpenUiExportImage, savedMessages, actorId);
    if (exportActor.current !== actorId) throw new Error('Export actor changed');
    return blocks;
  };

  const handleOpenSource = useCallback(
    async (citation: CitationData) => {
      setSourcesOpen(false);
      closeConversationContextPanel();
      try {
        await openCitationSource(citation, fileViewerDisplayMode, tCommon('ai.citations.defaultSource'), { conversationId, messageId: message.id });
      } catch {
        showError(tCommon('ai.errors.openFileTitle'), {
          description: tCommon('ai.errors.openFileDescription'),
        });
      }
    },
    [conversationId, fileViewerDisplayMode, message.id, tCommon],
  );

  const handleExportDocx = async () => {
    if (isExportingDocx) return;
    setIsExportingDocx(true);
    try {
      const actorId = user?.id;
      const blob = await exportBlocksToDocx(await buildAnswerExportBlocks(), exportTitle);
      if (exportActor.current !== actorId) throw new Error('Export actor changed');
      downloadBlob(blob, buildExportFilename(exportTitle, 'docx'));
      showSuccess(t('toasts.export.docxSuccess'));
    } catch {
      showError(t('toasts.export.failed'));
    } finally {
      setIsExportingDocx(false);
    }
  };

  const handleExportHtml = async () => {
    try {
      const blob = exportBlocksToHtml(await buildAnswerExportBlocks(), exportTitle);
      downloadBlob(blob, buildExportFilename(exportTitle, 'html'));
      showSuccess(t('toasts.export.htmlSuccess'));
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      const key = /open.*saved.*view|mounted|identity/i.test(reason) ? 'openui.html.exportOpen'
        : /state|revision|changed/i.test(reason) ? 'openui.html.exportChanged'
        : /capture|snapshot rendering/i.test(reason) ? 'openui.html.exportCapture'
        : /program|expression|evaluate|node|nesting|interactive/i.test(reason) ? 'openui.html.exportProgram' : 'toasts.export.failed';
      showError(t(key));
    }
  };

  const handleExportViaAgent = async (format: 'DOCX' | 'PPTX') => {
    if (!canExportViaAgent || conversationBusy || agentExportLock.current) return;
    const stillAvailable = () => {
      const state = useConversationStore.getState();
      return state.currentConversationId === conversationId && state.currentConversation?.runtimeMode !== 'governed'
        && !state.isStreaming && !state.isAwaitingFirstChunk
        && !Object.values(state.liveAnswers ?? {}).some((answer) => answer.conversationId === conversationId);
    };
    if (!stillAvailable()) return;
    agentExportLock.current = true;
    setIsExportingViaAgent(true);
    try {
      const actorId = user?.id;
      const captured = await buildMcpExportManifest(message, await savedExportMessages(), actorId);
      const manifest = await persistMcpExportImages(conversationId, captured, () => {
        if (exportActor.current !== actorId || !stillAvailable()) throw new Error('Export scope changed');
      });
      if (exportActor.current !== actorId) throw new Error('Export actor changed');
      if (!manifest.parts.length) throw new Error('Empty export');
      const citationMappings = mapConversationComponentsToContentParts(message.components ?? []).flatMap((part) => {
        if (part.type !== 'text') return [];
        const owned = (part.citations ?? []).filter((citation) => Boolean(part.componentId) && citation.parentId === part.componentId);
        const legacy = (part.citations ?? []).filter((citation) => !citation.parentId && !owned.some((own) => own.reference === citation.reference));
        const scoped = [...owned, ...legacy];
        for (const citation of scoped) {
          if (scoped.some((other) => other.reference === citation.reference && (other.fileName || other.source) + ':' + other.page !== (citation.fileName || citation.source) + ':' + citation.page)) throw new Error('Ambiguous export citation');
        }
        return scoped.map((citation) => ({ componentId: part.componentId, reference: citation.reference, fileName: citation.fileName || citation.source, page: citation.page }));
      });
      const data = JSON.stringify({ messageId: message.id, ...manifest, citations: citationMappings });
      const question = messages.find((candidate) => candidate.id === message.questionMessageId);
      if (!stillAvailable()) return;
      await sendMessage(conversationId, {
        content: t('messageActions.exportAgentRequest', { format, manifest: data }),
        parentMessageId: message.id,
        agentIds: message.agentIds ?? question?.agentIds,
        modelId: generationModelId,
      });
    } catch {
      showError(t('toasts.export.failed'));
    } finally {
      agentExportLock.current = false;
      setIsExportingViaAgent(false);
    }
  };

  const handleBranch = () => {
    const targetIndex = messages.findIndex((item) => item.id === message.id);
    const prefixIds = new Set(messages.slice(0, targetIndex + 1).map((item) => item.id));
    const selected = Object.fromEntries(Array.from(activeBranches.entries()).filter(([questionId, answerId]) => prefixIds.has(questionId) && prefixIds.has(answerId)));
    if (message.questionMessageId) selected[message.questionMessageId] = message.id;
    void createBranch(conversationId, {
      requestId: crypto.randomUUID(),
      targetMessageId: message.id,
      activeBranches: selected,
    });
  };

  const handlePlaybookHandoff = async () => {
    const targetIndex = messages.findIndex((item) => item.id === message.id);
    const prefixIds = new Set(messages.slice(0, targetIndex + 1).map((item) => item.id));
    const selected = Object.fromEntries(Array.from(activeBranches.entries()).filter(([questionId, answerId]) => prefixIds.has(questionId) && prefixIds.has(answerId)));
    if (message.questionMessageId) selected[message.questionMessageId] = message.id;
    const activeBranchEntries = Object.entries(selected).sort(([left], [right]) => left.localeCompare(right));
    const fingerprintSource = JSON.stringify({
      contractVersion: 1,
      targetMessageId: message.id,
      displayedAnswerVersion: displayedVersion,
      activeBranches: activeBranchEntries,
    });
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprintSource));
    const branchSelectionFingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (handoffCreationRequest.current?.fingerprint !== branchSelectionFingerprint) {
      handoffCreationRequest.current = {
        fingerprint: branchSelectionFingerprint,
        requestId: crypto.randomUUID(),
      };
    }
    void prepareHandoff(conversationId, {
      contractVersion: 1,
      targetMessageId: message.id,
      activeBranches: selected,
      branchSelectionFingerprint,
      displayedAnswerVersion: displayedVersion,
      creationRequestId: handoffCreationRequest.current.requestId,
    });
  };

  return (
    <>
      <div className={cn('mt-1 flex flex-wrap items-center gap-0.5', className)}>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className={`size-11 md:size-7 ${message.feedback === 'like' ? 'text-primary' : ''}`} onClick={handleLike} disabled={message.feedback === 'like'} aria-pressed={message.feedback === 'like'} aria-label={t('messageActions.likeAria')}>
                <ThumbsUp className={`h-3.5 w-3.5 ${message.feedback === 'like' ? 'fill-current' : ''}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{message.feedback === 'like' ? t('messageActions.liked') : t('messageActions.like')}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className={`size-11 md:size-7 ${message.feedback === 'dislike' ? 'text-primary' : ''}`} onClick={handleDislike} disabled={message.feedback === 'dislike'} aria-pressed={message.feedback === 'dislike'} aria-label={t('messageActions.dislikeAria')}>
                <ThumbsDown className={`h-3.5 w-3.5 ${message.feedback === 'dislike' ? 'fill-current' : ''}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{message.feedback === 'dislike' ? t('messageActions.disliked') : t('messageActions.dislike')}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-11 md:size-7" onClick={handleCopy} aria-label={t('messageActions.copyAria')}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('messageActions.copy')}</TooltipContent>
          </Tooltip>

          {citations.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Popover open={sourcesOpen} onOpenChange={setSourcesOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-11 md:size-7" aria-label={t('messageActions.sources')}>
                      <BookOpen className="h-3.5 w-3.5" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)] p-1">
                    <p className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('messageActions.sources')}</p>
                    <div className="max-h-72 overflow-y-auto">
                      {citations.map((citation, index) => {
                        const label = getCitationEntryLabel(citation, tCommon('ai.citations.defaultSource'));
                        return (
                          <button key={`${citation.source}-${index}`} type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start text-sm hover:bg-accent" onClick={() => void handleOpenSource(citation)} title={label}>
                            {isUrlCitation(citation) ? <Globe className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                            <span className="min-w-0 flex-1 truncate">{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </PopoverContent>
                </Popover>
              </TooltipTrigger>
              <TooltipContent>{t('messageActions.sources')}</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="size-11 md:size-7" aria-label={t('messageActions.exportAria')}>
                    <Share2 className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => void handleExportDocx()} disabled={isExportingDocx}>
                    <FileText className="h-3.5 w-3.5 me-2" />
                    {t('messageActions.exportDocx')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleExportPdf} disabled={isExportingPdf}>
                    <FileDown className="h-3.5 w-3.5 me-2" />
                    {t('messageActions.exportPdf')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleExportHtml}>
                    <Globe className="h-3.5 w-3.5 me-2" />
                    {t('messageActions.exportHtml')}
                  </DropdownMenuItem>
                  {canExportViaAgent && <>
                    <DropdownMenuItem onClick={() => void handleExportViaAgent('DOCX')} disabled={conversationBusy || isExportingViaAgent}>
                      <FileText className="h-3.5 w-3.5 me-2" />
                      {t('messageActions.exportAgentDocx')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => void handleExportViaAgent('PPTX')} disabled={conversationBusy || isExportingViaAgent}>
                      <FileDown className="h-3.5 w-3.5 me-2" />
                      {t('messageActions.exportEditablePptx')}
                    </DropdownMenuItem>
                  </>}
                </DropdownMenuContent>
              </DropdownMenu>
            </TooltipTrigger>
            <TooltipContent>{t('messageActions.exportAria')}</TooltipContent>
          </Tooltip>

          {isLastAiMessage && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="size-11 md:size-7" onClick={handleRegenerate} aria-label={t('messageActions.regenerateAria')}>
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('messageActions.regenerate')}</TooltipContent>
            </Tooltip>
          )}
        </TooltipProvider>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-11 md:size-7" aria-label={t('messageActions.moreActions')}>
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {canBranch && (
              <DropdownMenuItem onClick={handleBranch} disabled={isBranching}>
                {isBranching ? <Loader2 className="h-3.5 w-3.5 me-2 animate-spin" /> : <GitBranch className="h-3.5 w-3.5 me-2" />}
                {isBranching ? t('messageActions.branching') : t('messageActions.branch')}
              </DropdownMenuItem>
            )}
            {canPrepareHandoff && (
              <DropdownMenuItem
                onClick={() => {
                  void handlePlaybookHandoff();
                }}
                disabled={isPreparingHandoff}
              >
                {isPreparingHandoff ? <Loader2 className="h-3.5 w-3.5 me-2 animate-spin" /> : <Workflow className="h-3.5 w-3.5 me-2" />}
                {isPreparingHandoff ? t('messageActions.playbookPreparing') : t('messageActions.playbookHandoff')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => setReportOpen(true)}>
              <Flag className="h-3.5 w-3.5 me-2" />
              {t('messageActions.report')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {message.isComplete && !message.isStreaming && <TimingIndicator timeToFirstChunk={message.timeToFirstChunk} timeToFirstToken={message.timeToFirstToken} durationMs={message.durationMs} inputTokens={message.inputTokens} outputTokens={message.outputTokens} latencyMetrics={message.latencyMetrics} conversationUsage={visibleUsage ?? undefined} latencyInstrumentationEnabled={latencyInstrumentationEnabled} />}
        {visibleUsage && (
          <span className="ms-auto inline-flex w-full shrink-0 flex-wrap items-center justify-end gap-1.5 px-1 text-[11px] font-medium text-muted-foreground sm:w-auto sm:shrink sm:flex-nowrap" aria-label={t('usage.summaryLabel')} data-conversation-usage-summary>
            <span className="whitespace-nowrap">{formatCompactTokenTotal(visibleUsage.tokens.total, language)}</span>
            {formattedCost && <span className="hidden xl:inline">· {formattedCost}</span>}
            {formattedCarbon && <span className="whitespace-nowrap">· {formattedCarbon}</span>}
            <span className="hidden sm:inline" aria-hidden="true">·</span>
          </span>
        )}
        <div
          className="ms-auto flex min-w-0 items-center gap-1.5 px-1 text-[11px] text-muted-foreground min-[1100px]:ms-0"
          aria-label={t('messageActions.generationMetadata', {
            date: formattedCreatedAt,
            model: modelName,
          })}
        >
          <time dateTime={Number.isNaN(createdAt.getTime()) ? undefined : message.createdAt} className="whitespace-nowrap">
            {formattedCreatedAt}
          </time>
          <span aria-hidden="true">·</span>
          <span className="max-w-48 truncate" title={modelName}>
            {modelName}
          </span>
        </div>
      </div>

      <ReportDialog open={reportOpen} onOpenChange={setReportOpen} conversationId={conversationId} messageId={message.id} />
      {isExportingPdf && exportMarkdown && pdfActor === user?.id && (
        <PdfExportPortal title={exportTitle} subtitle={`${formattedCreatedAt} · ${modelName}`} contentKey={exportMarkdown} onFinish={handlePdfExportFinish}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={exportUrlTransform}>{exportMarkdown}</ReactMarkdown>
        </PdfExportPortal>
      )}
    </>
  );
});
