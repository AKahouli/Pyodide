import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { Loader2, Wand2, ArrowLeft, ArrowRight, Bot } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { MultiSelect, type MultiSelectOption } from '@/components/ui/multi-select';
import { useAgents, useAgentStore } from '@/modules/agent';
import { useModuleTranslation } from '@/modules/localization';
import { useTeamStore } from '../store';
import type { Team } from '../types';

interface CreateEditTeamDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, the dialog edits this team; otherwise it creates a new one. */
  team?: Team | null;
  onSubmit: (data: { name: string; description: string; agentIds: string[] }) => Promise<void>;
}

export function CreateEditTeamDialog({ open, onOpenChange, team, onSubmit }: CreateEditTeamDialogProps) {
  const { t } = useModuleTranslation('team');
  const navigate = useNavigate();
  const agents = useAgents();
  const [mode, setMode] = useState<'manual' | 'auto'>('manual');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [agentIds, setAgentIds] = useState<string[]>([]);
  const [prompt, setPrompt] = useState('');
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  // Ensure the agent list is available for the picker.
  useEffect(() => {
    if (open) useAgentStore.getState().fetchAgents();
  }, [open]);

  // Reset the form whenever the dialog opens (for either create or edit).
  useEffect(() => {
    if (!open) return;
    setMode('manual');
    setStep(0);
    setName(team?.name ?? '');
    setDescription(team?.description ?? '');
    setAgentIds(team?.members?.map((m) => m.agentId) ?? []);
    setPrompt('');
  }, [open, team]);

  const agentOptions = useMemo<MultiSelectOption[]>(
    () =>
      agents
        .filter((a) => a.isActive)
        .map((a) => ({ value: a.id, label: a.name, description: a.description || a.role })),
    [agents],
  );

  const canSubmit = name.trim().length >= 2 && !saving;
  const canGenerate = name.trim().length >= 2 && prompt.trim().length >= 10 && !saving;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await onSubmit({ name: name.trim(), description: description.trim(), agentIds });
      onOpenChange(false);
    } catch {
      toast.error(t('wizard.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = () => {
    if (!canGenerate) return;
    const data = { name: name.trim(), prompt: prompt.trim() };
    onOpenChange(false);
    navigate('/teams/generating');
    // The org-chart generating route subscribes for completion and redirects.
    useTeamStore
      .getState()
      .generateTeam(data)
      .catch(() => navigate('/teams', { replace: true }));
  };

  const nameField = (
    <div className='flex flex-col gap-1.5'>
      <Label htmlFor='team-name'>{t('createEdit.fields.name')}</Label>
      <Input
        id='team-name'
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={t('createEdit.fields.namePlaceholder')}
        maxLength={100}
      />
    </div>
  );

  const manualFields = (
    <div className='flex flex-col gap-4 py-2'>
      {(team || step === 0) && <>
      {nameField}
      <div className='flex flex-col gap-1.5'>
        <Label htmlFor='team-description'>{t('createEdit.fields.description')}</Label>
        <Textarea
          id='team-description'
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={t('createEdit.fields.descriptionPlaceholder')}
          maxLength={2000}
          rows={3}
        />
      </div>
      </>}
      {(team || step === 1) && <div className='flex flex-col gap-1.5'>
        <Label>{t('createEdit.fields.agents')}</Label>
        <MultiSelect
          options={agentOptions}
          value={agentIds}
          onValueChange={setAgentIds}
          placeholder={t('createEdit.fields.agentsPlaceholder')}
          searchPlaceholder={t('createEdit.fields.agentsSearchPlaceholder')}
          emptyText={t('createEdit.fields.agentsEmpty')}
        />
        <p className='mt-2 text-sm text-muted-foreground'>{t('wizard.membersHint')}</p>
      </div>}
      {!team && step === 2 && <div><h3 className='text-xl font-semibold'>{name}</h3><p className='mt-2 text-sm text-muted-foreground'>{description || t('wizard.noPurpose')}</p></div>}
      {(team || step > 0) && <ul className='max-h-64 divide-y overflow-y-auto'>{agentIds.map(id => {
        const agent = agents.find(a => a.id === id);
        return <li key={id} className='flex gap-3 py-3'><Bot className='mt-1 size-4 shrink-0 text-primary' /><div><p className='text-sm font-medium'>{agent?.name ?? t('wizard.unavailable')}</p><p className='mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground'>{agent?.description || agent?.role}</p></div></li>;
      })}</ul>}
    </div>
  );

  const autoFields = (
    <div className='flex flex-col gap-4 py-2'>
      {nameField}
      <div className='flex flex-col gap-1.5'>
        <Label htmlFor='team-prompt'>{t('autoBuilder.fields.prompt')}</Label>
        <Textarea
          id='team-prompt'
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={t('autoBuilder.fields.promptPlaceholder')}
          maxLength={10000}
          rows={5}
        />
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{team ? t('createEdit.titleEdit') : t('createEdit.titleCreate')}</DialogTitle>
          <DialogDescription>{t('createEdit.description')}</DialogDescription>
        </DialogHeader>

        {team ? (
          manualFields
        ) : (
          <Tabs value={mode} onValueChange={(v) => setMode(v as 'manual' | 'auto')}>
            <TabsList className='grid w-full grid-cols-2'>
              <TabsTrigger value='manual'>{t('createEdit.tabs.manual')}</TabsTrigger>
              <TabsTrigger value='auto'>{t('createEdit.tabs.autoBuilder')}</TabsTrigger>
            </TabsList>
            <TabsContent value='manual'><ol className='mb-5 mt-4 flex gap-3 text-sm'>{(['purpose','members','review'] as const).map((key, index) => <li key={key} aria-current={step === index ? 'step' : undefined} className={step === index ? 'font-semibold text-primary' : 'text-muted-foreground'}>{index + 1}. {t(`wizard.${key}`)}</li>)}</ol>{manualFields}</TabsContent>
            <TabsContent value='auto'>{autoFields}</TabsContent>
          </Tabs>
        )}

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={saving}>
            {t('createEdit.actions.cancel')}
          </Button>
          {!team && mode === 'manual' && step > 0 && <Button variant='ghost' onClick={() => setStep(step - 1)} disabled={saving}><ArrowLeft className='mr-2 size-4' />{t('wizard.back')}</Button>}
          {!team && mode === 'manual' && step < 2 ? <Button onClick={() => setStep(step + 1)} disabled={!canSubmit || step === 1 && !agentIds.length}>{t('wizard.next')}<ArrowRight className='ml-2 size-4' /></Button> : !team && mode === 'auto' ? (
            <Button onClick={handleGenerate} disabled={!canGenerate}>
              <Wand2 className='mr-2 size-4' />
              {t('autoBuilder.actions.generate')}
            </Button>
          ) : (
            <Button onClick={handleSubmit} disabled={!canSubmit}>
              {saving && <Loader2 className='mr-2 size-4 animate-spin' />}
              {team ? t('createEdit.actions.save') : t('createEdit.actions.create')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
