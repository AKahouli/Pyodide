import { AlertTriangle, ChevronDown, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { AgentGuardrails, GuardrailMode } from '../types';

interface AgentGuardrailsTabProps {
  value: AgentGuardrails;
  disabled: boolean;
  forceActivation: boolean;
  onChange: (next: AgentGuardrails) => void;
}

export function AgentGuardrailsTab({ value, disabled, forceActivation, onChange }: Readonly<AgentGuardrailsTabProps>) {
  const { t } = useModuleTranslation('agent');
  const setPromptField = <K extends keyof AgentGuardrails['promptInjection']>(key: K, next: AgentGuardrails['promptInjection'][K]) => {
    onChange({ ...value, promptInjection: { ...value.promptInjection, [key]: next } });
  };
  const setToolField = <K extends keyof AgentGuardrails['toolActionReview']>(key: K, next: AgentGuardrails['toolActionReview'][K]) => {
    onChange({ ...value, toolActionReview: { ...value.toolActionReview, [key]: next } });
  };

  return (
    <div className={cn('grid gap-5', disabled && 'opacity-60')}>
      {forceActivation ? (
        <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p>{t('createEdit.guardrails.forcedBanner')}</p>
        </div>
      ) : null}
      <div>
        <h3 className="text-base font-semibold">{t('createEdit.guardrails.heading')}</h3>
        <p className="text-sm text-muted-foreground">{t('createEdit.guardrails.description')}</p>
      </div>
      <section className="space-y-4 rounded-lg border p-4">
        <div><h4 className="font-semibold">{t('createEdit.guardrails.title')}</h4><p className="text-sm text-muted-foreground">{t('createEdit.guardrails.promptInjectionDescription')}</p></div>
        <div className="grid gap-3 md:grid-cols-2">
          <ProtectionCard title={t('createEdit.guardrails.inputGuardrail')} description={t('createEdit.guardrails.inputGuardrailDescription')} checked={value.promptInjection.inputEnabled} disabled={disabled} onCheckedChange={(checked) => setPromptField('inputEnabled', checked)} />
          <ProtectionCard title={t('createEdit.guardrails.outputGuardrail')} description={t('createEdit.guardrails.outputGuardrailDescription')} checked={value.promptInjection.outputEnabled} disabled={disabled} onCheckedChange={(checked) => setPromptField('outputEnabled', checked)} />
        </div>
        <ModeSelect value={value.promptInjection.mode} disabled={disabled} label={t('createEdit.guardrails.mode')} options={{ monitor: t('createEdit.guardrails.modeMonitor'), balanced: t('createEdit.guardrails.modeBalanced'), strict: t('createEdit.guardrails.modeStrict') }} onChange={(mode) => setPromptField('mode', mode)} />
        <div className="space-y-2"><Label htmlFor="agent-guardrails-block-message">{t('createEdit.guardrails.blockMessage')}</Label><Textarea id="agent-guardrails-block-message" value={value.promptInjection.blockMessage} disabled={disabled} rows={3} onChange={(event) => setPromptField('blockMessage', event.target.value)} /></div>
        <Collapsible className="rounded-lg border p-4">
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" className="flex w-full justify-between px-0">
            <span>{t('createEdit.guardrails.advancedTitle')}</span>
            <ChevronDown className="h-4 w-4" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-3">
          <p className="text-sm text-muted-foreground">{t('createEdit.guardrails.advancedDescription')}</p>
          <PromptTextarea id="agent-guardrails-input-prompt" label={t('createEdit.guardrails.inputClassifierPrompt')} value={value.promptInjection.inputClassifierPrompt} disabled={disabled} onChange={(next) => setPromptField('inputClassifierPrompt', next)} />
          <PromptTextarea id="agent-guardrails-output-prompt" label={t('createEdit.guardrails.outputClassifierPrompt')} value={value.promptInjection.outputClassifierPrompt} disabled={disabled} onChange={(next) => setPromptField('outputClassifierPrompt', next)} />
        </CollapsibleContent>
        </Collapsible>
      </section>
      <section className="space-y-4 rounded-lg border p-4">
        <div><h4 className="font-semibold">{t('createEdit.guardrails.toolActionTitle')}</h4><p className="text-sm text-muted-foreground">{t('createEdit.guardrails.toolCallGuardrailDescription')}</p></div>
        <ProtectionCard title={t('createEdit.guardrails.toolCallGuardrail')} description={t('createEdit.guardrails.toolCallGuardrailDescription')} checked={value.toolActionReview.enabled} disabled={disabled} onCheckedChange={(checked) => setToolField('enabled', checked)} />
        <ModeSelect value={value.toolActionReview.mode} disabled={disabled} label={t('createEdit.guardrails.mode')} options={{ monitor: t('createEdit.guardrails.modeMonitor'), balanced: t('createEdit.guardrails.modeBalanced'), strict: t('createEdit.guardrails.modeStrict') }} onChange={(mode) => setToolField('mode', mode)} />
        <div className="space-y-2"><Label htmlFor="agent-tool-action-block-message">{t('createEdit.guardrails.blockMessage')}</Label><Textarea id="agent-tool-action-block-message" value={value.toolActionReview.blockMessage} disabled={disabled} rows={3} onChange={(event) => setToolField('blockMessage', event.target.value)} /></div>
        <Collapsible className="rounded-lg border p-4"><CollapsibleTrigger asChild><Button type="button" variant="ghost" className="flex w-full justify-between px-0"><span>{t('createEdit.guardrails.advancedTitle')}</span><ChevronDown className="h-4 w-4" /></Button></CollapsibleTrigger><CollapsibleContent className="pt-3"><PromptTextarea id="agent-guardrails-tool-prompt" label={t('createEdit.guardrails.toolCallClassifierPrompt')} value={value.toolActionReview.classifierPrompt} disabled={disabled} onChange={(next) => setToolField('classifierPrompt', next)} /></CollapsibleContent></Collapsible>
      </section>
    </div>
  );
}

function ModeSelect({ value, disabled, label, options, onChange }: Readonly<{ value: GuardrailMode; disabled: boolean; label: string; options: Record<GuardrailMode, string>; onChange: (mode: GuardrailMode) => void }>) {
  return <div className="space-y-2"><Label>{label}</Label><Select value={value} disabled={disabled} onValueChange={(next) => onChange(next as GuardrailMode)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="monitor">{options.monitor}</SelectItem><SelectItem value="balanced">{options.balanced}</SelectItem><SelectItem value="strict">{options.strict}</SelectItem></SelectContent></Select></div>;
}

interface ProtectionCardProps {
  title: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
  badge?: string;
}

function ProtectionCard({ title, description, checked, disabled, onCheckedChange, badge }: Readonly<ProtectionCardProps>) {
  return (
    <div className="flex min-h-36 flex-col justify-between rounded-lg border p-4">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 text-primary" />
          {badge ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{badge}</span> : null}
        </div>
        <Label className="text-sm font-semibold">{title}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch aria-label={title} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  );
}

interface PromptTextareaProps {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}

function PromptTextarea({ id, label, value, disabled, onChange }: Readonly<PromptTextareaProps>) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} value={value} disabled={disabled} rows={5} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
