import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useModuleTranslation } from '@/modules/localization';

import { useCurrentPlaybook } from '../store';
import type { PlaybookTask, RouterCondition, RouterConditionOperator, RouterConfig } from '../types';

interface Props {
  value: RouterConfig;
  onChange: (next: RouterConfig) => void;
  disabled?: boolean;
  tasks?: PlaybookTask[];
  targetTaskId?: string;
}

const CONDITION_OPERATORS: RouterConditionOperator[] = ['equals', 'not_equals', 'contains', 'exists', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in'];

function stringifyConditionValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function parseConditionValue(raw: string, operator: RouterConditionOperator): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const asNumber = Number(trimmed);
    if (Number.isFinite(asNumber)) {
      return asNumber;
    }
  }

  if (operator === 'gt' || operator === 'gte' || operator === 'lt' || operator === 'lte') {
    const asNumber = Number(trimmed);
    return Number.isFinite(asNumber) ? asNumber : trimmed;
  }

  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed === 'null') return null;

  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

function normalizeRouterConfig(value: RouterConfig): RouterConfig {
  const labelSet = new Set(value.outputLabels);
  const conditions = (value.conditions ?? []).filter((condition) => labelSet.has(condition.label));
  const defaultLabel = value.defaultLabel && labelSet.has(value.defaultLabel)
    ? value.defaultLabel
    : value.outputLabels.find((label) => label !== '__error__') ?? value.outputLabels[0];
  const mode = value.mode === 'ai' || value.mode === 'deterministic'
    ? value.mode
    : conditions.length > 0 ? 'deterministic' : 'ai';

  return {
    ...value,
    conditions,
    defaultLabel,
    mode,
  };
}

function canReachTarget(fromId: string, targetId: string, edges: Array<{ sourceId: string; targetId: string }>): boolean {
  if (fromId === targetId) return true;

  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = adjacency.get(edge.sourceId) ?? [];
    targets.push(edge.targetId);
    adjacency.set(edge.sourceId, targets);
  }

  const queue = [fromId];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || seen.has(current)) continue;
    seen.add(current);

    for (const next of adjacency.get(current) ?? []) {
      if (next === targetId) return true;
      if (!seen.has(next)) queue.push(next);
    }
  }

  return false;
}

export function PlaybookRouterConfigSection({ value, onChange, disabled, tasks = [], targetTaskId }: Props) {
  const { t } = useModuleTranslation('playbook');
  const playbook = useCurrentPlaybook();

  const sourceTaskOptions = tasks.filter((task) => {
    if ((task.outputPorts?.length ?? 0) === 0 || task.id === targetTaskId) {
      return false;
    }

    if (!targetTaskId) {
      return true;
    }

    return canReachTarget(task.id, targetTaskId, playbook?.edges ?? []);
  });

  const emitChange = (next: RouterConfig) => {
    onChange(normalizeRouterConfig(next));
  };

  const addLabel = () => {
    emitChange({
      ...value,
      outputLabels: [...value.outputLabels, `label_${value.outputLabels.length + 1}`],
    });
  };

  const removeLabel = (idx: number) => {
    emitChange({
      ...value,
      outputLabels: value.outputLabels.filter((_, labelIdx) => labelIdx !== idx),
    });
  };

  const updateLabel = (idx: number, label: string) => {
    const nextLabels = [...value.outputLabels];
    nextLabels[idx] = label;
    emitChange({ ...value, outputLabels: nextLabels });
  };

  const addCondition = () => {
    const sourceTask = sourceTaskOptions[0];
    const nextCondition: RouterCondition = {
      label: value.outputLabels[0] ?? 'continue',
      sourceNode: sourceTask?.id,
      sourcePort: sourceTask?.outputPorts?.[0]?.id,
      operator: 'equals',
    };
    emitChange({
      ...value,
      conditions: [...(value.conditions ?? []), nextCondition],
    });
  };

  const updateCondition = (idx: number, patch: Partial<RouterCondition>) => {
    const nextConditions = [...(value.conditions ?? [])];
    nextConditions[idx] = { ...nextConditions[idx], ...patch };
    emitChange({ ...value, conditions: nextConditions });
  };

  const removeCondition = (idx: number) => {
    emitChange({
      ...value,
      conditions: (value.conditions ?? []).filter((_, conditionIdx) => conditionIdx !== idx),
    });
  };

  const mode = value.mode === 'ai' || value.mode === 'deterministic'
    ? value.mode
    : (value.conditions?.length ?? 0) > 0 ? 'deterministic' : 'ai';

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="router-mode">{t('routerEditor.mode')}</Label>
        <select
          id="router-mode"
          name="router-mode"
          value={mode}
          onChange={(event) => emitChange({ ...value, mode: event.target.value as 'ai' | 'deterministic' })}
          disabled={disabled}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="ai">{t('routerEditor.modeAi')}</option>
          <option value="deterministic">{t('routerEditor.modeDeterministic')}</option>
        </select>
        <p className="text-xs text-muted-foreground">{t('routerEditor.modeHint')}</p>
      </div>

      {mode === 'ai' && (
        <div className="space-y-2">
          <Label htmlFor="router-prompt">{t('routerEditor.prompt')}</Label>
          <Textarea
            id="router-prompt"
            name="router-prompt"
            value={value.prompt ?? ''}
            onChange={(event) => emitChange({ ...value, prompt: event.target.value || undefined })}
            disabled={disabled}
            rows={3}
            className="resize-y text-xs"
            placeholder={t('routerEditor.promptPlaceholder')}
          />
          <p className="text-xs text-muted-foreground">{t('routerEditor.promptHint')}</p>
        </div>
      )}

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>{t('routerEditor.outputLabels')}</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={addLabel}
            disabled={disabled}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('routerEditor.addLabel')}
          </Button>
        </div>
        <div className="space-y-1.5">
          {value.outputLabels.map((label, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Input
                value={label}
                onChange={(event) => updateLabel(idx, event.target.value)}
                disabled={disabled || label === '__error__'}
                className="h-8 text-xs"
              />
              {label !== '__error__' ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => removeLabel(idx)}
                  disabled={disabled}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <Label>{t('routerEditor.maxIterations')}</Label>
        <Input
          type="number"
          min={1}
          max={50}
          value={value.maxIterations}
          onChange={(event) => emitChange({ ...value, maxIterations: Math.max(1, Number(event.target.value || 1)) })}
          disabled={disabled}
          className="h-9"
        />
        <p className="text-xs text-muted-foreground">{t('routerEditor.maxIterationsHint')}</p>
      </div>

      <div className="space-y-2">
        <Label>{t('routerEditor.defaultRoute')}</Label>
        <select
          value={value.defaultLabel ?? ''}
          onChange={(event) => emitChange({ ...value, defaultLabel: event.target.value || undefined })}
          disabled={disabled}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
        >
          {value.outputLabels.map((label) => (
            <option key={label} value={label}>{label}</option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">{t('routerEditor.defaultRouteHint')}</p>
      </div>

      <div className="space-y-2 rounded-md border p-3">
        <div className="flex items-center justify-between">
          <Label>{t('routerEditor.conditions')}</Label>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={addCondition}
            disabled={disabled}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('routerEditor.addCondition')}
          </Button>
        </div>

        {mode === 'ai' && <p className="text-xs text-muted-foreground">{t('routerEditor.conditionsIgnoredInAi')}</p>}
        {(value.conditions ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('routerEditor.conditionsEmpty')}</p>
        ) : (
          <div className="space-y-3">
            {(value.conditions ?? []).map((condition, idx) => {
              const sourceTask = tasks.find((task) => task.id === condition.sourceNode);
              const sourcePorts = sourceTask?.outputPorts ?? [];

              return (
                <div key={idx} className="space-y-2 rounded-md border p-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">{t('routerEditor.routeLabel')}</Label>
                      <select
                        value={condition.label}
                        onChange={(event) => updateCondition(idx, { label: event.target.value })}
                        disabled={disabled}
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                      >
                        {value.outputLabels.map((label) => (
                          <option key={label} value={label}>{label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('routerEditor.operator')}</Label>
                      <select
                        value={condition.operator}
                        onChange={(event) => updateCondition(idx, { operator: event.target.value as RouterConditionOperator })}
                        disabled={disabled}
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                      >
                        {CONDITION_OPERATORS.map((operator) => (
                          <option key={operator} value={operator}>{t(`routerEditor.operator.${operator}`)}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('routerEditor.sourceNode')}</Label>
                      <select
                        value={condition.sourceNode ?? ''}
                        onChange={(event) => {
                          const sourceNode = event.target.value || undefined;
                          const nextSourcePort = sourceTaskOptions.find((task) => task.id === sourceNode)?.outputPorts?.[0]?.id;
                          updateCondition(idx, { sourceNode, sourcePort: nextSourcePort });
                        }}
                        disabled={disabled}
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                      >
                        <option value="">{t('routerEditor.selectNode')}</option>
                        {sourceTaskOptions.map((task) => (
                          <option key={task.id} value={task.id}>{task.title}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('routerEditor.sourcePort')}</Label>
                      <select
                        value={condition.sourcePort ?? ''}
                        onChange={(event) => updateCondition(idx, { sourcePort: event.target.value || undefined })}
                        disabled={disabled}
                        className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                      >
                        <option value="">{t('routerEditor.selectPort')}</option>
                        {sourcePorts.map((port) => (
                          <option key={port.id} value={port.id}>{port.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('routerEditor.path')}</Label>
                      <Input
                        value={condition.path ?? ''}
                        onChange={(event) => updateCondition(idx, { path: event.target.value || undefined })}
                        disabled={disabled}
                        className="h-8 text-xs"
                        placeholder="verdict"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">{t('routerEditor.value')}</Label>
                      <Input
                        value={stringifyConditionValue(condition.value)}
                        onChange={(event) => updateCondition(idx, { value: parseConditionValue(event.target.value, condition.operator) })}
                        disabled={disabled || condition.operator === 'exists'}
                        className="h-8 text-xs"
                        placeholder={condition.operator === 'exists' ? t('routerEditor.existsNoValue') : t('routerEditor.valuePlaceholder')}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeCondition(idx)}
                      disabled={disabled}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
