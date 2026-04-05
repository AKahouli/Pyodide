import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, Sparkles, Wand2 } from 'lucide-react';
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
import { usePlaybookStore } from '../store';
import { handleApiError } from '@/lib/api-error';
import { useModuleTranslation } from '@/modules/localization';
import { PlaybookWorkspaceSelect } from './PlaybookWorkspaceSelect';
import type { GeneratePlaybookData } from '../types';

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

  const handleClose = (v: boolean) => {
    if (!v) resetForm();
    onOpenChange(v);
  };

  const isManualValid = name.trim().length >= 2 && workspaces.length > 0;
  const isAutoValid = (autoName.trim() || deriveAutoName(autoPrompt)).length >= 2 && autoPrompt.trim().length >= 10 && autoWorkspaces.length > 0;
  const promptSuggestions = [
    t('create.promptSuggestionResearch'),
    t('create.promptSuggestionETL'),
  ];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-h-[72vh] overflow-y-auto border-stone-200 bg-stone-50 p-0 shadow-[0_28px_90px_-44px_rgba(15,23,42,0.24)] sm:max-w-5xl">
        <div className="relative overflow-hidden rounded-lg">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,rgba(148,163,184,0.12)_1px,transparent_1px),linear-gradient(to_bottom,rgba(148,163,184,0.12)_1px,transparent_1px)] bg-[size:28px_28px]" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.95),_transparent_38%),radial-gradient(circle_at_bottom_right,_rgba(226,232,240,0.55),_transparent_42%)]" />

          <div className="relative border-b border-stone-200/70 px-6 pb-3 pt-5 backdrop-blur-sm">
            <DialogHeader className="space-y-1.5">
              <DialogTitle className="text-[32px] font-semibold tracking-tight text-slate-900">
                {t('create.title')}
              </DialogTitle>
              <p className="max-w-3xl text-sm leading-5 text-slate-600">
                {tab === 'auto' ? t('create.autoModalSubtitle') : t('create.manualModalSubtitle')}
              </p>
            </DialogHeader>
          </div>

          <div className="relative px-6 pb-5 pt-3">
            <Tabs value={tab} onValueChange={(v) => setTab(v as 'manual' | 'auto')}>
              <TabsList className="grid h-11 w-full grid-cols-2 rounded-full border border-stone-200/80 bg-stone-100/90 p-1 shadow-none sm:max-w-[296px]">
                <TabsTrigger value="manual" className="rounded-full py-1.5 text-sm text-slate-600 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm">
                  {t('create.tabManual')}
                </TabsTrigger>
                <TabsTrigger value="auto" className="gap-1.5 rounded-full py-1.5 text-sm text-slate-600 data-[state=active]:bg-white data-[state=active]:text-slate-900 data-[state=active]:shadow-sm">
                  <Wand2 className="h-3.5 w-3.5" />
                  {t('create.tabAutoBuilder')}
                </TabsTrigger>
              </TabsList>

              {/* Manual creation */}
              <TabsContent value="manual" className="space-y-4 pt-5">
                <div className="grid gap-4 rounded-3xl border border-stone-200 bg-white/85 p-5 shadow-sm md:grid-cols-2">
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
              <TabsContent value="auto" className="pt-3">
                <div className="space-y-3">
                  <section className="rounded-[28px] border border-stone-200 bg-white/92 p-4 shadow-sm">
                    <div className="mb-3 flex items-start justify-between gap-4">
                      <div className="space-y-1.5">
                        <div className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-stone-100 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-600">
                          <Sparkles className="h-3.5 w-3.5" />
                          {t('create.autoBuilderBadge')}
                        </div>
                        <div>
                          <h2 className="text-[26px] font-semibold tracking-tight text-slate-900">
                            {t('create.autoHeroTitle')}
                          </h2>
                          <p className="mt-1 text-sm leading-5 text-slate-600">
                            {t('create.autoHeroDescription')}
                          </p>
                        </div>
                      </div>
                      <div className="hidden rounded-full border border-stone-200 bg-stone-100 px-3 py-1 text-xs text-slate-500 sm:block">
                        {t('create.autoPromptHint')}
                      </div>
                    </div>

                    <div className="rounded-[24px] border border-stone-200 bg-stone-50 p-3">
                      <div className="flex min-h-[120px] flex-col gap-3 rounded-[20px] border border-stone-200/90 bg-white px-5 py-4">
                        <div>
                          <p className="text-sm font-medium text-slate-900">{t('create.promptLabel')}</p>
                          <p className="text-xs text-slate-500">{t('create.autoPromptBarCaption')}</p>
                        </div>

                        <Textarea
                          id="auto-prompt"
                          value={autoPrompt}
                          onChange={(e) => setAutoPrompt(e.target.value)}
                          placeholder={t('create.promptPlaceholder')}
                          maxLength={5000}
                          rows={3}
                          className="min-h-[72px] resize-none border-0 bg-transparent px-0 py-0 text-base leading-7 text-slate-900 shadow-none placeholder:text-slate-400 focus-visible:ring-0"
                          onKeyDown={(e) => {
                            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && isAutoValid) {
                              e.preventDefault();
                              handleGenerate();
                            }
                          }}
                        />

                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs leading-5 text-slate-500">
                            {t('create.autoMinimalHint')}
                          </p>
                          <Button
                            type="button"
                            size="icon"
                            className="h-11 w-11 rounded-full bg-slate-900 text-white shadow-sm transition hover:bg-slate-700 disabled:bg-slate-300 disabled:text-slate-500"
                            onClick={handleGenerate}
                            disabled={!isAutoValid}
                          >
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </section>

                  <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
                    <div className="rounded-3xl border border-stone-200 bg-white/88 p-4 shadow-sm">
                      <div className="mb-3">
                        <p className="text-sm font-medium text-slate-900">{t('create.autoSuggestionsTitle')}</p>
                        <p className="text-xs text-slate-500">{t('create.autoSuggestionsBody')}</p>
                      </div>
                      <div className="grid gap-2">
                        {promptSuggestions.map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm leading-6 text-slate-700 transition hover:border-stone-300 hover:bg-stone-100 hover:text-slate-900"
                            onClick={() => setAutoPrompt(suggestion)}
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    </div>

                    <section className="grid gap-3 rounded-3xl border border-stone-200 bg-white/88 p-4 shadow-sm">
                      <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
                        <div className="mb-3 space-y-1">
                          <Label htmlFor="auto-name">{t('create.autoNameLabel')}</Label>
                          <p className="text-xs text-slate-500">{t('create.autoNameHint')}</p>
                        </div>
                        <Input
                          id="auto-name"
                          value={autoName}
                          onChange={(e) => setAutoName(e.target.value)}
                          placeholder={deriveAutoName(autoPrompt) || t('create.autoNamePlaceholder')}
                          maxLength={100}
                        />
                      </div>

                      <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-4">
                        <div className="mb-3 space-y-1">
                          <Label>{t('workspace.label')}</Label>
                          <p className="text-xs text-slate-500">{t('create.autoWorkspaceHint')}</p>
                        </div>
                        <PlaybookWorkspaceSelect value={autoWorkspaces} onChange={setAutoWorkspaces} />
                        {autoWorkspaces.length === 0 && (
                          <p className="mt-2 text-xs text-destructive">Select at least one workspace.</p>
                        )}
                      </div>
                    </section>
                  </section>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <div className="relative border-t border-stone-200/70 bg-white/80 px-6 py-3 backdrop-blur-sm">
            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                {t('common.cancel')}
              </Button>
              {tab === 'manual' ? (
                <Button onClick={handleCreate} disabled={!isManualValid || isCreating}>
                  {isCreating ? t('common.creating') : t('create.submit')}
                </Button>
              ) : (
                <Button onClick={handleGenerate} disabled={!isAutoValid}>
                  {t('create.submit')}
                </Button>
              )}
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
