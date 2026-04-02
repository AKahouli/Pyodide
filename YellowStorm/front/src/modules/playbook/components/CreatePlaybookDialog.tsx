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
  const [tab, setTab] = useState<'manual' | 'auto'>('manual');

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
    if (!name.trim() || name.length < 2) return;
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

    if (resolvedName.length < 2 || !autoPrompt.trim() || autoPrompt.length < 10) return;
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

  const isManualValid = name.trim().length >= 2;
  const isAutoValid = (autoName.trim() || deriveAutoName(autoPrompt)).length >= 2 && autoPrompt.trim().length >= 10;
  const promptSuggestions = [
    t('create.promptSuggestionResearch'),
    t('create.promptSuggestionETL'),
    t('create.promptSuggestionMicroservices'),
    t('create.promptSuggestionAnsible'),
    t('create.promptSuggestionDbt'),
  ];

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="overflow-hidden border-slate-200 bg-white sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('create.title')}</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as 'manual' | 'auto')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="manual">{t('create.tabManual')}</TabsTrigger>
            <TabsTrigger value="auto" className="gap-1.5">
              <Wand2 className="h-3.5 w-3.5" />
              {t('create.tabAutoBuilder')}
            </TabsTrigger>
          </TabsList>

          {/* Manual creation */}
          <TabsContent value="manual" className="space-y-4 pt-2">
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
            <div className="space-y-2">
              <Label htmlFor="playbook-desc">{t('create.descriptionLabel')}</Label>
              <Textarea
                id="playbook-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('create.descriptionPlaceholder')}
                maxLength={2000}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('workspace.label')}</Label>
              <PlaybookWorkspaceSelect value={workspaces} onChange={setWorkspaces} />
            </div>
          </TabsContent>

          {/* Auto builder */}
          <TabsContent value="auto" className="space-y-6 pt-4">
            <div className="relative overflow-hidden rounded-3xl border border-slate-200 bg-slate-950 px-6 py-8 text-white shadow-[0_24px_80px_-40px_rgba(15,23,42,0.9)]">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(168,85,247,0.16),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(56,189,248,0.16),_transparent_30%)]" />
              <div className="relative space-y-6">
                <div className="space-y-2 text-center">
                  <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-slate-300">
                    <Sparkles className="h-3.5 w-3.5" />
                    {t('create.autoBuilderBadge')}
                  </div>
                  <h2 className="text-2xl font-semibold tracking-tight text-white">
                    {t('create.autoHeroTitle')}
                  </h2>
                  <p className="mx-auto max-w-2xl text-sm text-slate-300">
                    {t('create.autoHeroDescription')}
                  </p>
                </div>

                <div className="rounded-[28px] border border-white/10 bg-black/30 p-3 shadow-inner shadow-black/20 backdrop-blur-sm">
                  <div className="flex min-h-[180px] flex-col gap-3 rounded-[22px] border border-white/10 bg-slate-900/80 p-4">
                    <Textarea
                      id="auto-prompt"
                      value={autoPrompt}
                      onChange={(e) => setAutoPrompt(e.target.value)}
                      placeholder={t('create.promptPlaceholder')}
                      maxLength={5000}
                      rows={5}
                      className="min-h-[120px] resize-none border-0 bg-transparent px-0 py-0 text-base leading-7 text-white shadow-none placeholder:text-slate-400 focus-visible:ring-0"
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && isAutoValid) {
                          e.preventDefault();
                          handleGenerate();
                        }
                      }}
                    />
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-slate-400">
                        {t('create.autoPromptHint')}
                      </span>
                      <Button
                        type="button"
                        size="icon"
                        className="h-11 w-11 rounded-full bg-violet-500 text-white shadow-lg shadow-violet-950/40 transition hover:bg-violet-400 disabled:bg-slate-700 disabled:text-slate-400"
                        onClick={handleGenerate}
                        disabled={!isAutoValid}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {promptSuggestions.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  className="rounded-full border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-700 transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700"
                  onClick={() => setAutoPrompt(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>

            <div className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <div className="space-y-2">
                <Label htmlFor="auto-name">{t('create.autoNameLabel')}</Label>
                <Input
                  id="auto-name"
                  value={autoName}
                  onChange={(e) => setAutoName(e.target.value)}
                  placeholder={deriveAutoName(autoPrompt) || t('create.autoNamePlaceholder')}
                  maxLength={100}
                />
                <p className="text-xs text-slate-500">
                  {t('create.autoNameHint')}
                </p>
              </div>
              <div className="space-y-2">
                <Label>{t('workspace.label')}</Label>
                <PlaybookWorkspaceSelect value={autoWorkspaces} onChange={setAutoWorkspaces} />
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            {t('common.cancel')}
          </Button>
          {tab === 'manual' ? (
            <Button onClick={handleCreate} disabled={!isManualValid || isCreating}>
              {isCreating ? t('common.creating') : t('create.submit')}
            </Button>
          ) : null}
          {tab === 'auto' ? (
            <Button onClick={handleGenerate} disabled={!isAutoValid}>
              <Wand2 className="h-4 w-4 mr-2" />
              {t('create.generate')}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
