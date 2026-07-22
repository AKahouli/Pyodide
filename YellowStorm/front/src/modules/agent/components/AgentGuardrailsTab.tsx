import { AlertTriangle, ChevronDown, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { PromptInjectionGuardrailsConfig } from '../types';

interface AgentGuardrailsTabProps {
  value: PromptInjectionGuardrailsConfig;
  disabled: boolean;
  forceActivation: boolean;
  onChange: (next: PromptInjectionGuardrailsConfig) => void;
}

export function AgentGuardrailsTab({ value, disabled, forceActivation, onChange }: Readonly<AgentGuardrailsTabProps>) {
  const { t } = useModuleTranslation('agent');
  const setField = <K extends keyof PromptInjectionGuardrailsConfig>(key: K, next: PromptInjectionGuardrailsConfig[K]) => {
    onChange({ ...value, [key]: next });
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
        <h3 className="text-base font-semibold">{t('createEdit.guardrails.title')}</h3>
        <p className="text-sm text-muted-foreground">{t('createEdit.guardrails.description')}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <ProtectionCard
          title={t('createEdit.guardrails.inputGuardrail')}
          description={t('createEdit.guardrails.inputGuardrailDescription')}
          checked={value.inputGuardrailEnabled}
          disabled={disabled}
          onCheckedChange={(checked) => setField('inputGuardrailEnabled', checked)}
        />
        <ProtectionCard
          title={t('createEdit.guardrails.outputGuardrail')}
          description={t('createEdit.guardrails.outputGuardrailDescription')}
          checked={value.outputGuardrailEnabled}
          disabled={disabled}
          onCheckedChange={(checked) => setField('outputGuardrailEnabled', checked)}
        />
        <ProtectionCard
          title={t('createEdit.guardrails.toolCallGuardrail')}
          description={t('createEdit.guardrails.toolCallGuardrailDescription')}
          badge={t('createEdit.guardrails.toolCallGuardrailBadge')}
          checked={value.toolCallGuardrailEnabled}
          disabled={disabled}
          onCheckedChange={(checked) => setField('toolCallGuardrailEnabled', checked)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="agent-guardrails-block-message">{t('createEdit.guardrails.blockMessage')}</Label>
        <p className="text-xs text-muted-foreground">{t('createEdit.guardrails.blockMessageDescription')}</p>
        <Textarea id="agent-guardrails-block-message" value={value.blockMessage} disabled={disabled} rows={3} onChange={(event) => setField('blockMessage', event.target.value)} />
      </div>
      <Collapsible className="rounded-lg border p-4">
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" className="flex w-full justify-between px-0">
            <span>{t('createEdit.guardrails.advancedTitle')}</span>
            <ChevronDown className="h-4 w-4" />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-3">
          <p className="text-sm text-muted-foreground">{t('createEdit.guardrails.advancedDescription')}</p>
          <PromptTextarea id="agent-guardrails-input-prompt" label={t('createEdit.guardrails.inputClassifierPrompt')} value={value.inputClassifierPrompt} disabled={disabled} onChange={(next) => setField('inputClassifierPrompt', next)} />
          <PromptTextarea id="agent-guardrails-output-prompt" label={t('createEdit.guardrails.outputClassifierPrompt')} value={value.outputClassifierPrompt} disabled={disabled} onChange={(next) => setField('outputClassifierPrompt', next)} />
          <PromptTextarea id="agent-guardrails-tool-prompt" label={t('createEdit.guardrails.toolCallClassifierPrompt')} value={value.toolCallClassifierPrompt} disabled={disabled} onChange={(next) => setField('toolCallClassifierPrompt', next)} />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
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
