import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { parseApiError } from '@/lib/api-error';
import { showError, showSuccess } from '@/lib/notifications';
import { useModuleTranslation } from '@/modules/localization';
import { useUpdateGovernanceScope, type GovernanceScope, type GovernanceScopeKnowledgeSettings, type GovernanceScopeKnowledgeSourceMode } from '@/modules/governance';

const DEFAULT_KNOWLEDGE_SETTINGS: GovernanceScopeKnowledgeSettings = {
  sourceMode: 'llm_only',
  webSourcesEnabled: false,
  webAllowedDomains: [],
  webBlockedDomains: [],
};

const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Mirrors the backend normalization: hosts only, scheme/path/port stripped. */
export function parseDomainList(input: string): { domains: string[]; invalid?: string } {
  const domains: string[] = [];
  for (const rawEntry of input.split(/[\n,;]+/)) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    const host = entry.toLowerCase().replace(/^https?:\/\//, '').split('/')[0].split(':')[0];
    if (!DOMAIN_PATTERN.test(host)) return { domains, invalid: entry };
    domains.push(host);
  }
  return { domains };
}

export function createKnowledgeSourcesDraft(scope: GovernanceScope) {
  const settings = scope.knowledge ?? DEFAULT_KNOWLEDGE_SETTINGS;
  return {
    sourceMode: settings.sourceMode,
    webSourcesEnabled: settings.webSourcesEnabled,
    allowedDomainsInput: settings.webAllowedDomains.join(', '),
    blockedDomainsInput: settings.webBlockedDomains.join(', '),
  };
}

interface Props {
  programId: string | null;
  scope: GovernanceScope;
}

/**
 * Knowledge source policy for a governed scope: LLM-only vs the mapped
 * workspaces, plus optional web access restricted by domain allow/block lists.
 */
export function KnowledgeSourcesCard({ programId, scope }: Readonly<Props>): JSX.Element {
  const { t } = useModuleTranslation('governance');
  const updateScope = useUpdateGovernanceScope(programId, scope.id);
  const [draft, setDraft] = useState(() => createKnowledgeSourcesDraft(scope));

  useEffect(() => {
    setDraft(createKnowledgeSourcesDraft(scope));
  }, [scope]);

  const parsed = useMemo(() => ({
    allowed: parseDomainList(draft.allowedDomainsInput),
    blocked: parseDomainList(draft.blockedDomainsInput),
  }), [draft.allowedDomainsInput, draft.blockedDomainsInput]);

  const saved = scope.knowledge ?? DEFAULT_KNOWLEDGE_SETTINGS;
  const isDirty = draft.sourceMode !== saved.sourceMode
    || draft.webSourcesEnabled !== saved.webSourcesEnabled
    || JSON.stringify(parsed.allowed.domains) !== JSON.stringify(saved.webAllowedDomains)
    || JSON.stringify(parsed.blocked.domains) !== JSON.stringify(saved.webBlockedDomains);
  const isInvalid = Boolean(parsed.allowed.invalid || parsed.blocked.invalid);

  const handleSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isDirty || isInvalid) return;
    updateScope.mutate({
      knowledge: {
        sourceMode: draft.sourceMode,
        webSourcesEnabled: draft.webSourcesEnabled,
        webAllowedDomains: parsed.allowed.domains,
        webBlockedDomains: parsed.blocked.domains,
      },
    }, {
      onSuccess: () => showSuccess(t('scopeShell.knowledge.sources.saved')),
      onError: (error) => showError(t('scopeShell.knowledge.sources.saveError'), { description: parseApiError(error).message }),
    });
  };

  return (
    <form onSubmit={handleSave} className='rounded-xl border bg-background p-4'>
      <p className='text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{t('scopeShell.knowledge.sources.title')}</p>
      <p className='mt-1 text-xs text-muted-foreground'>{t('scopeShell.knowledge.sources.hint')}</p>
      <RadioGroup value={draft.sourceMode} onValueChange={(value) => setDraft({ ...draft, sourceMode: value as GovernanceScopeKnowledgeSourceMode })} className='mt-3 grid gap-2'>
        <KnowledgeSourceOption
          id='governance-knowledge-llm-only'
          value='llm_only'
          selected={draft.sourceMode === 'llm_only'}
          label={t('scopeShell.knowledge.sources.llmOnly')}
          description={t('scopeShell.knowledge.sources.llmOnlyHint')}
        />
        <KnowledgeSourceOption
          id='governance-knowledge-workspaces-only'
          value='workspaces_only'
          selected={draft.sourceMode === 'workspaces_only'}
          label={t('scopeShell.knowledge.sources.workspacesOnly')}
          description={t('scopeShell.knowledge.sources.workspacesOnlyHint')}
        />
      </RadioGroup>
      <div className='mt-4 flex items-center justify-between gap-3 rounded-lg border border-dashed p-3'>
        <div>
          <Label htmlFor='governance-knowledge-web-sources'>{t('scopeShell.knowledge.sources.webSources')}</Label>
          <p className='mt-0.5 text-xs text-muted-foreground'>{t('scopeShell.knowledge.sources.webSourcesHint')}</p>
        </div>
        <Switch id='governance-knowledge-web-sources' checked={draft.webSourcesEnabled} onCheckedChange={(checked) => setDraft({ ...draft, webSourcesEnabled: checked })} />
      </div>
      {draft.webSourcesEnabled && (
        <div className='mt-3 grid gap-3'>
          <div className='grid gap-1.5'>
            <Label htmlFor='governance-knowledge-allowed-domains'>{t('scopeShell.knowledge.sources.webAllowed')}</Label>
            <Textarea id='governance-knowledge-allowed-domains' value={draft.allowedDomainsInput} onChange={(event) => setDraft({ ...draft, allowedDomainsInput: event.target.value })} placeholder={t('scopeShell.knowledge.sources.domainsPlaceholder')} rows={2} />
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor='governance-knowledge-blocked-domains'>{t('scopeShell.knowledge.sources.webBlocked')}</Label>
            <Textarea id='governance-knowledge-blocked-domains' value={draft.blockedDomainsInput} onChange={(event) => setDraft({ ...draft, blockedDomainsInput: event.target.value })} placeholder={t('scopeShell.knowledge.sources.domainsPlaceholder')} rows={2} />
          </div>
          <p className='text-xs text-muted-foreground'>{t('scopeShell.knowledge.sources.webAnyDomain')}</p>
          {parsed.allowed.invalid && <p role='alert' className='text-xs text-destructive'>{t('scopeShell.knowledge.sources.invalidDomain', { domain: parsed.allowed.invalid })}</p>}
          {parsed.blocked.invalid && <p role='alert' className='text-xs text-destructive'>{t('scopeShell.knowledge.sources.invalidDomain', { domain: parsed.blocked.invalid })}</p>}
        </div>
      )}
      <div className='mt-3'>
        <Button type='submit' size='sm' disabled={!isDirty || isInvalid || updateScope.isPending}>{t('scopeShell.settings.save')}</Button>
      </div>
    </form>
  );
}

function KnowledgeSourceOption({ id, value, selected, label, description }: Readonly<{ id: string; value: string; selected: boolean; label: string; description: string }>): JSX.Element {
  return (
    <div className={`flex items-start gap-2.5 rounded-lg border p-3 transition ${selected ? 'border-primary/60 bg-primary/5' : 'border-border/60'}`}>
      <RadioGroupItem id={id} value={value} className='mt-0.5' />
      <div className='grid gap-0.5'>
        <Label htmlFor={id} className='font-medium'>{label}</Label>
        <p className='text-xs text-muted-foreground'>{description}</p>
      </div>
    </div>
  );
}
