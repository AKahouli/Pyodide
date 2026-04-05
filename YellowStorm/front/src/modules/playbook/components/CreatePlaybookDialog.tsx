import { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, PencilLine, Sparkles, Wand2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { usePlaybookStore } from '../store';
import { handleApiError } from '@/lib/api-error';
import { useModuleTranslation } from '@/modules/localization';
import { PlaybookWorkspaceSelect } from './PlaybookWorkspaceSelect';
import type { GeneratePlaybookData } from '../types';
import { rewritePlaybookPromptStream } from '../api';
import { toast } from 'sonner';

function getCaretCoordinates(textarea: HTMLTextAreaElement, position: number) {
  const style = window.getComputedStyle(textarea);
  const div = document.createElement('div');
  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.whiteSpace = 'pre-wrap';
  div.style.wordWrap = 'break-word';
  div.style.overflow = 'hidden';
  div.style.left = '-9999px';
  div.style.top = '0';

  div.style.boxSizing = style.boxSizing;
  div.style.width = `${textarea.clientWidth}px`;
  div.style.height = style.height;
  div.style.overflowX = style.overflowX;
  div.style.overflowY = style.overflowY;
  div.style.borderTopWidth = style.borderTopWidth;
  div.style.borderRightWidth = style.borderRightWidth;
  div.style.borderBottomWidth = style.borderBottomWidth;
  div.style.borderLeftWidth = style.borderLeftWidth;
  div.style.paddingTop = style.paddingTop;
  div.style.paddingRight = style.paddingRight;
  div.style.paddingBottom = style.paddingBottom;
  div.style.paddingLeft = style.paddingLeft;
  div.style.font = style.font;
  div.style.fontFamily = style.fontFamily;
  div.style.fontSize = style.fontSize;
  div.style.fontWeight = style.fontWeight;
  div.style.fontStyle = style.fontStyle;
  div.style.letterSpacing = style.letterSpacing;
  div.style.textTransform = style.textTransform;
  div.style.textAlign = style.textAlign;
  div.style.textIndent = style.textIndent;
  div.style.lineHeight = style.lineHeight;
  div.style.wordSpacing = style.wordSpacing;
  div.style.tabSize = style.tabSize;
  div.textContent = textarea.value.slice(0, position);

  const span = document.createElement('span');
  span.textContent = '\u200b';
  div.appendChild(span);
  document.body.appendChild(div);

  const top = span.offsetTop;
  const left = span.offsetLeft;
  const height = span.offsetHeight || parseFloat(style.lineHeight) || 20;
  const scrollTop = textarea.scrollTop;
  const scrollLeft = textarea.scrollLeft;

  document.body.removeChild(div);
  return { top: top - scrollTop, left: left - scrollLeft, height };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  retryData?: GeneratePlaybookData | null;
}

export function CreatePlaybookDialog({ open, onOpenChange, retryData }: Props) {
  const [tab, setTab] = useState<'manual' | 'auto'>('auto');

  // Manual fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  const [isCreating, setIsCreating] = useState(false);

  // Auto builder fields
  const [autoName, setAutoName] = useState('');
  const [autoPrompt, setAutoPrompt] = useState('');
  const [autoWorkspaces, setAutoWorkspaces] = useState<string[]>([]);
  const [isRewritingPrompt, setIsRewritingPrompt] = useState(false);
  const [isRewriteStreamingStarted, setIsRewriteStreamingStarted] = useState(false);
  const [rewriteShortcut, setRewriteShortcut] = useState({ top: 0, left: 0, visible: false });
  const promptTextareaWrapperRef = useRef<HTMLDivElement | null>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const createPlaybook = usePlaybookStore((s) => s.createPlaybook);
  const generatePlaybook = usePlaybookStore((s) => s.generatePlaybook);
  const navigate = useNavigate();
  const { t } = useModuleTranslation('playbook');

  const deriveAutoName = (prompt: string) => {
    const cleaned = prompt
      .replace(/\s+/g, ' ')
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim();

    if (!cleaned) return '';

    return cleaned.slice(0, 60).trim() || cleaned;
  };

  // Restore auto builder fields when retrying
  useEffect(() => {
    if (retryData && open) {
      setTab('auto');
      setAutoName(retryData.name);
      setAutoPrompt(retryData.prompt);
      setAutoWorkspaces(retryData.workspaces ?? []);
    }
  }, [retryData, open]);

  const resetForm = () => {
    setName('');
    setDescription('');
    setWorkspaces([]);
    setAutoName('');
    setAutoPrompt('');
    setAutoWorkspaces([]);
  };

  const handleCreate = async () => {
    if (!name.trim() || name.length < 2 || workspaces.length === 0) return;
    setIsCreating(true);
    try {
      const playbook = await createPlaybook({
        name: name.trim(),
        description: description.trim(),
        workspaces: workspaces.length > 0 ? workspaces : undefined,
      });
      onOpenChange(false);
      resetForm();
      navigate(`/playbooks/${playbook.id}`);
    } catch (err) {
      handleApiError(err);
    } finally {
      setIsCreating(false);
    }
  };

  const handleGenerate = () => {
    const resolvedName = autoName.trim() || deriveAutoName(autoPrompt);

    if (resolvedName.length < 2 || !autoPrompt.trim() || autoPrompt.length < 10 || autoWorkspaces.length === 0) return;
    const data: GeneratePlaybookData = {
      name: resolvedName,
      prompt: autoPrompt.trim(),
      workspaces: autoWorkspaces.length > 0 ? autoWorkspaces : undefined,
    };
    onOpenChange(false);
    navigate('/playbooks/generating');
    generatePlaybook(data).then(() => {
      resetForm();
    }).catch((err) => {
      handleApiError(err);
      navigate('/playbooks');
    });
  };

  const handleRewritePrompt = async () => {
    const currentPrompt = autoPrompt.trim();
    if (currentPrompt.length < 10 || isRewritingPrompt) return;

    setIsRewritingPrompt(true);
    setIsRewriteStreamingStarted(false);
    setAutoPrompt('');
    try {
      const result = await rewritePlaybookPromptStream({ prompt: currentPrompt }, (chunk) => {
        setIsRewriteStreamingStarted(true);
        setAutoPrompt((prev) => `${prev}${chunk}`);
      });
      if (result.prompt?.trim()) {
        setAutoPrompt(result.prompt.trim());
        toast.success(t('create.rewritePromptSuccess'));
      }
    } catch (err) {
      setAutoPrompt(currentPrompt);
      handleApiError(err);
    } finally {
      setIsRewritingPrompt(false);
      setIsRewriteStreamingStarted(false);
    }
  };

  const handleClose = (v: boolean) => {
    if (!v) resetForm();
    onOpenChange(v);
  };

  const updateRewriteShortcut = useCallback(() => {
    const textarea = promptTextareaRef.current;
    const wrapper = promptTextareaWrapperRef.current;

    if (!open || tab !== 'auto' || !textarea || !wrapper || isRewritingPrompt || !autoPrompt.trim()) {
      setRewriteShortcut((prev) => (prev.visible ? { ...prev, visible: false } : prev));
      return;
    }

    const caretPos = textarea.selectionStart ?? autoPrompt.length;
    const caret = getCaretCoordinates(textarea, caretPos);
    const textareaRect = textarea.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();

    const iconSize = 40;
    const left = Math.min(
      Math.max(4, textareaRect.left - wrapperRect.left + caret.left + 14),
      Math.max(4, wrapperRect.width - iconSize - 4),
    );
    const top = Math.min(
      Math.max(4, textareaRect.top - wrapperRect.top + caret.top + (caret.height / 2) - (iconSize / 2)),
      Math.max(4, wrapperRect.height - iconSize - 4),
    );

    setRewriteShortcut({ top, left, visible: true });
  }, [open, tab, isRewritingPrompt, autoPrompt]);

  useLayoutEffect(() => {
    updateRewriteShortcut();
  }, [updateRewriteShortcut]);

  useEffect(() => {
    const textarea = promptTextareaRef.current;
    if (!open || tab !== 'auto' || !textarea) return;

    const handleSelectionChange = () => {
      if (document.activeElement === textarea) {
        updateRewriteShortcut();
      }
    };

    const handleResize = () => updateRewriteShortcut();
    const resizeObserver = new ResizeObserver(() => updateRewriteShortcut());

    document.addEventListener('selectionchange', handleSelectionChange);
    window.addEventListener('resize', handleResize);
    textarea.addEventListener('scroll', handleResize);
    resizeObserver.observe(textarea);
    if (promptTextareaWrapperRef.current) {
      resizeObserver.observe(promptTextareaWrapperRef.current);
    }

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      window.removeEventListener('resize', handleResize);
      textarea.removeEventListener('scroll', handleResize);
      resizeObserver.disconnect();
    };
  }, [open, tab, updateRewriteShortcut]);

  const isManualValid = name.trim().length >= 2 && workspaces.length > 0;
  const isAutoValid = (autoName.trim() || deriveAutoName(autoPrompt)).length >= 2 && autoPrompt.trim().length >= 10 && autoWorkspaces.length > 0;
  const promptSuggestions = [
    { label: t('create.promptChipETL'), prompt: t('create.promptSuggestionETL') },
    { label: t('create.promptChipAnsible'), prompt: t('create.promptSuggestionAnsible') },
    { label: t('create.promptChipDbt'), prompt: t('create.promptSuggestionDbt') },
    { label: t('create.promptChipResearch'), prompt: t('create.promptSuggestionResearch') },
    { label: t('create.promptChipMicroservices'), prompt: t('create.promptSuggestionMicroservices') },
  ];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[88vh] overflow-y-auto border-border bg-background p-0 text-foreground shadow-[0_28px_90px_-44px_rgba(15,23,42,0.35)] sm:max-w-5xl">
        <div className="relative overflow-hidden rounded-lg">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.62),_transparent_40%)] dark:bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.06),_transparent_40%)]" />
          <div className="pointer-events-none absolute inset-0 bg-primary/[0.025] dark:bg-primary/[0.03] [mask-image:radial-gradient(circle_at_bottom_right,black,transparent_34%)]" />
          <div className="pointer-events-none absolute right-[14%] top-[9%] h-16 w-16 rounded-sm bg-primary/[0.045] dark:bg-primary/[0.08]" />
          <div className="pointer-events-none absolute right-[8%] top-[22%] h-16 w-16 rounded-sm bg-primary/[0.06] dark:bg-primary/[0.12]" />
          <div className="pointer-events-none absolute right-[17%] top-[36%] h-16 w-16 rounded-sm bg-primary/[0.04] dark:bg-primary/[0.08]" />

          <div className="relative border-b border-border px-6 pb-3 pt-5 backdrop-blur-sm">
            <DialogHeader className="space-y-1.5">
              <DialogTitle className={cn(
                'font-semibold tracking-tight !text-foreground',
                tab === 'auto' ? 'text-lg' : 'text-[32px]',
              )}>
                {t('create.title')}
              </DialogTitle>
              <p className={cn(
                'max-w-3xl text-sm leading-5 !text-muted-foreground',
                tab === 'auto' ? 'hidden' : '',
              )}>
                {t('create.manualModalSubtitle')}
              </p>
            </DialogHeader>
          </div>

          <div className="relative px-6 pb-5 pt-3">
            <Tabs value={tab} onValueChange={(v) => setTab(v as 'manual' | 'auto')}>
              <TabsList className="grid h-11 w-full grid-cols-2 rounded-full border border-border bg-background/60 p-1 shadow-none sm:max-w-[296px]">
                <TabsTrigger value="manual" className="rounded-full py-1.5 text-sm text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm">
                  {t('create.tabManual')}
                </TabsTrigger>
                <TabsTrigger value="auto" className="gap-1.5 rounded-full py-1.5 text-sm text-muted-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm">
                  <Wand2 className="h-3.5 w-3.5" />
                  {t('create.tabAutoBuilder')}
                </TabsTrigger>
              </TabsList>

              {/* Manual creation */}
              <TabsContent value="manual" className="space-y-4 pt-5">
                <div className="grid gap-4 rounded-3xl border border-border bg-card/85 p-5 shadow-sm md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="playbook-name">{t('create.nameLabel')}</Label>
                    <Input
                      id="playbook-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t('create.namePlaceholder')}
                      maxLength={100}
                      onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="playbook-desc">{t('create.descriptionLabel')}</Label>
                    <Textarea
                      id="playbook-desc"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder={t('create.descriptionPlaceholder')}
                      maxLength={2000}
                      rows={4}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>{t('workspace.label')}</Label>
                    <PlaybookWorkspaceSelect value={workspaces} onChange={setWorkspaces} />
                    {workspaces.length === 0 && (
                      <p className="text-xs text-destructive">Select at least one workspace.</p>
                    )}
                  </div>
                </div>
              </TabsContent>

              {/* Auto builder */}
              <TabsContent value="auto" className="pt-5">
                <section className="mx-auto flex max-w-4xl flex-col items-center gap-5 pb-2 text-center">
                  <div className="space-y-3">
                    <div>
                       <h2 className="text-balance text-[28px] font-semibold tracking-tight !text-foreground sm:text-[46px]">
                         {t('create.autoHeroTitle')}
                       </h2>
                       <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 !text-muted-foreground sm:text-base">
                         {t('create.autoHeroDescription')}
                       </p>
                    </div>
                  </div>

                  <div className="w-full rounded-[32px] border border-border bg-card/85 p-3 shadow-[0_34px_80px_-42px_rgba(15,23,42,0.35)] backdrop-blur-md">
                    <div className="relative flex min-h-[147px] flex-col rounded-[28px] bg-background/90 px-5 py-4 text-left sm:px-8 sm:py-5">
                      <div className="mb-3 flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium text-foreground">{t('create.promptLabel')}</p>
                        </div>
                      </div>

                      <div className="relative" ref={promptTextareaWrapperRef}>
                        {isRewritingPrompt && !isRewriteStreamingStarted && (
                          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                            <div className="h-5 w-5 animate-spin rounded-full border-2 border-blue-500/70 border-t-transparent" />
                          </div>
                        )}

                        <Textarea
                          ref={promptTextareaRef}
                          id="auto-prompt"
                          value={autoPrompt}
                          onChange={(e) => {
                            setAutoPrompt(e.target.value);
                            requestAnimationFrame(() => requestAnimationFrame(updateRewriteShortcut));
                          }}
                          onKeyUp={updateRewriteShortcut}
                          onClick={updateRewriteShortcut}
                          onSelect={updateRewriteShortcut}
                          onScroll={updateRewriteShortcut}
                          onFocus={updateRewriteShortcut}
                          placeholder={t('create.promptPlaceholder')}
                          maxLength={5000}
                          rows={3}
                          className="min-h-[83px] resize-y border-0 bg-transparent px-0 py-0 text-base leading-7 text-foreground shadow-none placeholder:text-muted-foreground focus-visible:ring-0 sm:text-[18px]"
                          onKeyDown={(e) => {
                            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && isAutoValid) {
                              e.preventDefault();
                              handleGenerate();
                            }
                          }}
                        />

                        {rewriteShortcut.visible && !isRewritingPrompt && (
                          <button
                            type="button"
                            className="absolute z-20 flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background/95 text-foreground shadow-md shadow-slate-900/10 backdrop-blur-sm transition hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-300"
                            style={{ left: rewriteShortcut.left, top: rewriteShortcut.top }}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={handleRewritePrompt}
                            aria-label={t('create.rewritePromptAria')}
                            title={t('create.rewritePromptAria')}
                          >
                            <Sparkles className="h-4 w-4" />
                          </button>
                        )}
                      </div>

                      <div className="mt-4 flex items-end justify-between gap-4">
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="h-12 w-12 shrink-0 rounded-full border-border bg-background/70 text-muted-foreground hover:text-foreground"
                            onClick={handleRewritePrompt}
                            disabled={isRewritingPrompt || autoPrompt.trim().length < 10}
                            aria-label={t('create.rewritePromptAria')}
                            title={t('create.rewritePromptAria')}
                          >
                            {isRewritingPrompt ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <PencilLine className="h-4 w-4" />}
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border-2 border-blue-400/70 bg-primary text-primary-foreground shadow-sm transition hover:bg-primary/90 hover:border-blue-300 disabled:bg-slate-300 disabled:text-slate-500 dark:disabled:bg-slate-700 dark:disabled:text-slate-400 before:pointer-events-none before:absolute before:inset-0 before:rounded-full before:border before:border-blue-400/70 before:opacity-50 before:content-[''] before:animate-[pulse_4s_ease-in-out_infinite]"
                            onClick={handleGenerate}
                            disabled={!isAutoValid}
                          >
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex w-full flex-wrap items-center justify-center gap-3">
                    {promptSuggestions.map((suggestion) => (
                      <button
                        key={suggestion.label}
                        type="button"
                        className={cn(
                          'rounded-full border px-4 py-2 text-sm transition',
                          autoPrompt === suggestion.prompt
                            ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                            : 'border-border bg-background/60 text-muted-foreground backdrop-blur-sm hover:border-primary/30 hover:bg-background',
                        )}
                        onClick={() => setAutoPrompt(suggestion.prompt)}
                      >
                        {suggestion.label}
                      </button>
                    ))}
                  </div>

                  <div className="grid w-full gap-4 text-left lg:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
                    <div className="rounded-[24px] border border-border bg-card/70 p-4 backdrop-blur-sm">
                      <div className="mb-3 space-y-1">
                        <Label htmlFor="auto-name" className="text-sm">{t('create.autoNameLabel')}</Label>
                        <p className="text-xs leading-5 text-muted-foreground">{t('create.autoNameHint')}</p>
                      </div>
                      <Input
                        id="auto-name"
                        value={autoName}
                        onChange={(e) => setAutoName(e.target.value)}
                        placeholder={deriveAutoName(autoPrompt) || t('create.autoNamePlaceholder')}
                        maxLength={100}
                        className="border-border bg-background/80"
                      />
                    </div>

                    <div className="rounded-[24px] border border-border bg-card/70 p-4 backdrop-blur-sm">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="space-y-1">
                          <Label className="text-sm">{t('workspace.label')}</Label>
                          <p className="text-xs leading-5 text-muted-foreground">{t('create.autoWorkspaceHint')}</p>
                        </div>
                        <Button type="button" onClick={handleGenerate} disabled={!isAutoValid} className="hidden rounded-full bg-primary px-5 text-primary-foreground hover:bg-primary/90 sm:inline-flex">
                          {t('create.generate')}
                        </Button>
                      </div>
                      <PlaybookWorkspaceSelect value={autoWorkspaces} onChange={setAutoWorkspaces} />
                      {autoWorkspaces.length === 0 && (
                        <p className="mt-2 text-xs text-destructive">Select at least one workspace.</p>
                      )}
                    </div>
                  </div>
                </section>
              </TabsContent>
            </Tabs>
          </div>

          {tab === 'manual' && (
            <div className="relative border-t border-border bg-background/80 px-6 py-3 backdrop-blur-sm">
              <DialogFooter>
                <Button variant="outline" onClick={() => handleClose(false)}>
                  {t('common.cancel')}
                </Button>
                <Button onClick={handleCreate} disabled={!isManualValid || isCreating}>
                  {isCreating ? t('common.creating') : t('create.submit')}
                </Button>
              </DialogFooter>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
