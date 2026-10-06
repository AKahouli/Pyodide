import { useModuleTranslation } from '@/modules/localization/useModuleTranslation';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { MultiSelect } from '@/components/ui/multi-select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

import type { RootConfigurationMode } from '../types';
import type { RootExecutionPolicyFormValues } from './root-execution-policy-schema';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

interface RootExecutionPolicyFieldsProps {
  policy: RootExecutionPolicyFormValues;
  delegateAgentIds: string[];
  delegateTeamIds: string[];
  onPolicyChange: (policy: RootExecutionPolicyFormValues) => void;
  onDelegateAgentsChange: (ids: string[]) => void;
  onDelegateTeamsChange: (ids: string[]) => void;
  agentOptions: SelectOption[];
  teamOptions: SelectOption[];
  readOnly?: boolean;
}

/**
 * Shared "Delegation & execution" editor body for mono-agent roots (WP02).
 * Controlled: the hosting editor owns the form state. Selection ids live on
 * the editor payload (delegateAgentIds / delegateTeamIds), the policy object
 * carries everything else. Backend ceilings re-validate on save.
 */
export function RootExecutionPolicyFields({
  policy,
  delegateAgentIds,
  delegateTeamIds,
  onPolicyChange,
  onDelegateAgentsChange,
  onDelegateTeamsChange,
  agentOptions,
  teamOptions,
  readOnly = false,
}: RootExecutionPolicyFieldsProps) {
  const { t } = useModuleTranslation('agent');
  const p = 'createEdit.rootExecution';

  const set = (patch: Partial<RootExecutionPolicyFormValues>) => onPolicyChange({ ...policy, ...patch });
  const setSection = <K extends 'delegation' | 'temporaryWorkers' | 'fanout' | 'background' | 'limits'>(
    section: K,
    patch: Partial<RootExecutionPolicyFormValues[K]>,
  ) => set({ [section]: { ...policy[section], ...patch } } as Partial<RootExecutionPolicyFormValues>);

  const overrideFor = (agentId: string): RootConfigurationMode =>
    policy.perAgentModeOverrides.find((o) => o.agentId === agentId)?.configurationMode
    ?? policy.delegation.defaultConfigurationMode;

  const setOverride = (agentId: string, mode: RootConfigurationMode) => {
    const others = policy.perAgentModeOverrides.filter((o) => o.agentId !== agentId);
    const next = mode === policy.delegation.defaultConfigurationMode
      ? others
      : [...others, { agentId, configurationMode: mode }];
    set({ perAgentModeOverrides: next });
  };

  const numberField = (
    label: string,
    key: string,
    section: 'temporaryWorkers' | 'fanout' | 'background' | 'limits',
    min: number,
    max: number,
  ) => (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        disabled={readOnly}
        value={String((policy[section] as unknown as Record<string, number>)[key] ?? '')}
        onChange={(e) => {
          const parsed = Number(e.target.value);
          if (!Number.isNaN(parsed)) setSection(section, { [key]: parsed });
        }}
        data-testid={`root-policy-${section}-${key}`}
      />
    </div>
  );

  const toggleField = (
    label: string,
    hint: string,
    section: 'delegation' | 'temporaryWorkers' | 'fanout' | 'background' | 'limits',
    key: string,
  ) => (
    <div className="flex items-start justify-between gap-4 py-2">
      <div className="space-y-0.5">
        <Label>{label}</Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch
        disabled={readOnly}
        checked={Boolean((policy[section] as unknown as Record<string, unknown>)[key])}
        onCheckedChange={(checked) => setSection(section, { [key]: checked })}
        data-testid={`root-policy-${section}-${key}`}
      />
    </div>
  );

  // Effective pool preview: direct picks plus (client-side knowledge of) the
  // selected teams themselves. Team member expansion is the resolver's job.
  const poolRows: Array<{ key: string; label: string; description?: string; source: string; agentId: string }> = [
    ...delegateAgentIds.map((id) => {
      const option = agentOptions.find((o) => o.value === id);
      return {
        key: `a:${id}`,
        agentId: id,
        label: option?.label ?? t(`${p}.pool.unknownAgent`),
        description: option?.description,
        source: t(`${p}.pool.sourceDirect`),
      };
    }),
    ...delegateTeamIds.map((id) => {
      const option = teamOptions.find((o) => o.value === id);
      return {
        key: `t:${id}`,
        agentId: id,
        label: option?.label ?? t(`${p}.pool.unknownTeam`),
        description: option?.description,
        source: t(`${p}.pool.sourceTeam`),
      };
    }),
  ];

  return (
    <div className="space-y-6" data-testid="root-execution-policy-fields">
      {/* Specialists */}
      <section className="space-y-3">
        {toggleField(t(`${p}.delegation.enabled`), t(`${p}.delegation.enabledHint`), 'delegation', 'enabled')}
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t(`${p}.delegation.defaultMode`)}</Label>
          <Select
            disabled={readOnly || !policy.delegation.enabled}
            value={policy.delegation.defaultConfigurationMode}
            onValueChange={(v) => setSection('delegation', { defaultConfigurationMode: v as RootConfigurationMode })}
            data-testid="root-policy-default-mode"
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="native">{t(`${p}.mode.native`)}</SelectItem>
              <SelectItem value="root_constrained">{t(`${p}.mode.rootConstrained`)}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t(`${p}.delegation.agents`)}</Label>
          <div className={cn(readOnly || !policy.delegation.enabled && "pointer-events-none opacity-60")}>
            <MultiSelect
              options={agentOptions}
              value={delegateAgentIds}
              onValueChange={(ids) => {
                if (readOnly || !policy.delegation.enabled) return;
                onDelegateAgentsChange(ids);
                set({ perAgentModeOverrides: policy.perAgentModeOverrides.filter((o) => ids.includes(o.agentId)) });
              }}
              placeholder={t(`${p}.delegation.agentsPlaceholder`)}
              searchPlaceholder={t(`${p}.delegation.searchPlaceholder`)}
              emptyText={t(`${p}.delegation.empty`)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t(`${p}.delegation.teams`)}</Label>
          <div className={cn(readOnly || !policy.delegation.enabled && "pointer-events-none opacity-60")}>
            <MultiSelect
              options={teamOptions}
              value={delegateTeamIds}
              onValueChange={(ids) => {
                if (readOnly || !policy.delegation.enabled) return;
                onDelegateTeamsChange(ids);
              }}
              placeholder={t(`${p}.delegation.teamsPlaceholder`)}
              searchPlaceholder={t(`${p}.delegation.searchPlaceholder`)}
              emptyText={t(`${p}.delegation.empty`)}
            />
          </div>
          <p className="text-xs text-muted-foreground">{t(`${p}.delegation.teamsHint`)}</p>
        </div>
      </section>

      {/* Effective pool preview */}
      <section className="space-y-2">
        <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t(`${p}.pool.title`)}
        </Label>
        {poolRows.length === 0 ? (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            {t(`${p}.pool.empty`)}
          </p>
        ) : (
          <div className="overflow-hidden rounded-md border" data-testid="root-policy-pool">
            <table className="w-full text-sm">
              <tbody>
                {poolRows.map((row) => (
                  <tr key={row.key} className="border-b last:border-b-0">
                    <td className="px-3 py-2">
                      <span className="font-medium">{row.label}</span>
                      {row.description && (
                        <span className="block text-xs text-muted-foreground">{row.description}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{row.source}</td>
                    <td className="px-3 py-2 text-right">
                      {row.key.startsWith('a:') && (
                        <Select
                          disabled={readOnly}
                          value={overrideFor(row.agentId)}
                          onValueChange={(v) => setOverride(row.agentId, v as RootConfigurationMode)}
                        >
                          <SelectTrigger className="ml-auto h-7 w-[180px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="native">{t(`${p}.mode.native`)}</SelectItem>
                            <SelectItem value="root_constrained">{t(`${p}.mode.rootConstrained`)}</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Temporary workers */}
      <section className="space-y-2">
        {toggleField(
          t(`${p}.temporaryWorkers.enabled`),
          t(`${p}.temporaryWorkers.enabledHint`),
          'temporaryWorkers',
          'enabled',
        )}
        {policy.temporaryWorkers.enabled && (
          <div className={cn('grid gap-4 md:grid-cols-3', readOnly && 'opacity-60')}>
            {numberField(t(`${p}.temporaryWorkers.max`), 'maxPerWorkGroup', 'temporaryWorkers', 0, 8)}
          </div>
        )}
      </section>

      {/* Fan-out */}
      <section className="space-y-2">
        {toggleField(t(`${p}.fanout.enabled`), t(`${p}.fanout.enabledHint`), 'fanout', 'enabled')}
        {policy.fanout.enabled && (
          <div className={cn('grid gap-4 md:grid-cols-3', readOnly && 'opacity-60')}>
            {numberField(t(`${p}.fanout.maxItems`), 'maxItems', 'fanout', 1, 50)}
            {toggleField(
              t(`${p}.fanout.allowBackground`),
              t(`${p}.fanout.allowBackgroundHint`),
              'fanout',
              'allowBackground',
            )}
          </div>
        )}
      </section>

      {/* Background */}
      <section className="space-y-2">
        {toggleField(
          t(`${p}.background.enabled`),
          t(`${p}.background.enabledHint`),
          'background',
          'enabled',
        )}
        {policy.background.enabled && (
          <div className={cn('grid gap-4 md:grid-cols-3', readOnly && 'opacity-60')}>
            {numberField(t(`${p}.background.maxOutstanding`), 'maxOutstandingPerConversation', 'background', 1, 5)}
            {numberField(t(`${p}.background.timeout`), 'taskTimeoutSeconds', 'background', 30, 3600)}
            {numberField(t(`${p}.background.maxAttempts`), 'maxAttempts', 'background', 1, 5)}
          </div>
        )}
      </section>

      {/* Shared limits */}
      <section className="space-y-2">
        <Label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t(`${p}.limits.title`)}
        </Label>
        <p className="text-xs text-muted-foreground">{t(`${p}.limits.depthNote`)}</p>
        <div className={cn('grid gap-4 md:grid-cols-3', readOnly && 'opacity-60')}>
          {numberField(t(`${p}.limits.maxParallelWorkers`), 'maxParallelWorkers', 'limits', 1, 8)}
          {numberField(t(`${p}.limits.maxChildExecutions`), 'maxChildExecutionsPerWorkGroup', 'limits', 1, 64)}
          {numberField(t(`${p}.limits.maxDuration`), 'maxWorkGroupDurationSeconds', 'limits', 60, 3600)}
        </div>
      </section>
    </div>
  );
}
