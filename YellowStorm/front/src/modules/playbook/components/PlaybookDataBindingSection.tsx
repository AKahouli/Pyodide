import { useCallback, useMemo } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useModuleTranslation } from '@/modules/localization';

import { useCurrentPlaybook, usePlaybookStore } from '../store';
import type { DataBinding, DataBindingSourceKind, PlaybookTask, TaskInputPort, TaskOutputPort } from '../types';

interface Props {
  targetNodeId?: string;
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

function getSourcePortOptions(tasks: PlaybookTask[], sourceNodeId?: string): TaskOutputPort[] {
  if (!sourceNodeId) return [];
  return tasks.find((task) => task.id === sourceNodeId)?.outputPorts ?? [];
}

export function PlaybookDataBindingSection({ targetNodeId }: Props) {
  const { t } = useModuleTranslation('playbook');
  const playbook = useCurrentPlaybook();
  const updateDataBindings = usePlaybookStore((s) => s.updateDataBindings);

  const allBindings = playbook?.dataBindings ?? [];
  const allTasks = playbook?.tasks ?? [];
  const targetNode = targetNodeId ? allTasks.find((task) => task.id === targetNodeId) : undefined;
  const inputPorts = targetNode?.inputPorts ?? [];
  const nodeBindings = targetNodeId
    ? allBindings.filter((binding) => binding.targetNode === targetNodeId)
    : allBindings;

  const bindingByPort = useMemo(
    () => new Map(nodeBindings.map((binding) => [binding.targetPort, binding])),
    [nodeBindings],
  );

  const extraBindings = useMemo(() => {
    const validPortIds = new Set(inputPorts.map((port) => port.id));
    return nodeBindings.filter((binding) => !validPortIds.has(binding.targetPort));
  }, [inputPorts, nodeBindings]);

  const sourceNodeOptions = useMemo(
    () => allTasks.filter((task) => {
      if (task.id === targetNodeId || (task.outputPorts?.length ?? 0) === 0) {
        return false;
      }

      if (!targetNodeId) {
        return true;
      }

      return canReachTarget(task.id, targetNodeId, playbook?.edges ?? []);
    }),
    [allTasks, playbook?.edges, targetNodeId],
  );

  const sourceKindOptions: Array<{ value: DataBindingSourceKind; label: string }> = [
    { value: 'node-output', label: t('dataBindingEditor.nodeOutput') },
    { value: 'trigger', label: t('dataBindingEditor.trigger') },
    { value: 'state', label: t('dataBindingEditor.state') },
    { value: 'constant', label: t('dataBindingEditor.constant') },
    { value: 'expression', label: t('dataBindingEditor.expressionLabel') },
  ];

  const addBinding = useCallback((port?: TaskInputPort) => {
    const nextBinding: DataBinding = {
      id: `db-${crypto.randomUUID().slice(0, 8)}`,
      targetNode: targetNodeId ?? '',
      targetPort: port?.id ?? inputPorts[0]?.id ?? 'default',
      sourceKind: 'node-output',
    };
    updateDataBindings([...allBindings, nextBinding]);
  }, [allBindings, inputPorts, targetNodeId, updateDataBindings]);

  const removeBinding = useCallback((id: string) => {
    updateDataBindings(allBindings.filter((binding) => binding.id !== id));
  }, [allBindings, updateDataBindings]);

  const updateBinding = useCallback((id: string, patch: Partial<DataBinding>) => {
    const existingBinding = allBindings.find((binding) => binding.id === id);
    if (!existingBinding) {
      return;
    }

    const nextBinding = { ...existingBinding, ...patch };
    updateDataBindings(allBindings.map((binding) => (binding.id === id ? nextBinding : binding)));
  }, [allBindings, updateDataBindings]);

  const renderSourceFields = (binding: DataBinding, targetPort?: TaskInputPort) => {
    switch (binding.sourceKind) {
      case 'node-output':
        return (
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">{t('dataBindingEditor.sourceNode')}</Label>
              <select
                value={binding.sourceNode ?? ''}
                onChange={(event) => {
                  const sourceNode = event.target.value || undefined;
                  const nextSourcePort = getSourcePortOptions(allTasks, sourceNode)
                    .find((port) => port.artifactKind === targetPort?.artifactKind)?.id
                    ?? getSourcePortOptions(allTasks, sourceNode)[0]?.id;
                  updateBinding(binding.id, { sourceNode, sourcePort: nextSourcePort });
                }}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="">{t('dataBindingEditor.selectNode')}</option>
                {sourceNodeOptions.map((task) => (
                  <option key={task.id} value={task.id}>{task.title}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('dataBindingEditor.sourcePort')}</Label>
              <select
                value={binding.sourcePort ?? ''}
                onChange={(event) => updateBinding(binding.id, { sourcePort: event.target.value || undefined })}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
              >
                <option value="">{t('dataBindingEditor.selectPort')}</option>
                {getSourcePortOptions(allTasks, binding.sourceNode).map((port) => (
                  <option key={port.id} value={port.id}>{port.name}</option>
                ))}
              </select>
            </div>
          </div>
        );
      case 'constant':
        return (
          <div className="space-y-1">
            <Label className="text-xs">{t('dataBindingEditor.constantValue')}</Label>
            <Input
              value={typeof binding.constantValue === 'string' ? binding.constantValue : ''}
              onChange={(event) => updateBinding(binding.id, { constantValue: event.target.value || undefined })}
              className="h-8 text-xs"
              placeholder="value"
            />
          </div>
        );
      case 'expression':
        return (
          <div className="space-y-1">
            <Label className="text-xs">{t('dataBindingEditor.expression')}</Label>
            <Input
              value={binding.expression ?? ''}
              onChange={(event) => updateBinding(binding.id, { expression: event.target.value || undefined })}
              className="h-8 text-xs"
              placeholder="{{item.name}}"
            />
          </div>
        );
      case 'trigger':
      case 'state':
        return (
          <div className="space-y-1">
            <Label className="text-xs">{binding.sourceKind === 'trigger' ? t('dataBindingEditor.triggerPath') : t('dataBindingEditor.statePath')}</Label>
            <Input
              value={binding.sourceKind === 'trigger' ? binding.triggerPath ?? '' : binding.statePath ?? ''}
              onChange={(event) => updateBinding(
                binding.id,
                binding.sourceKind === 'trigger'
                  ? { triggerPath: event.target.value || undefined }
                  : { statePath: event.target.value || undefined },
              )}
              className="h-8 text-xs"
              placeholder={binding.sourceKind === 'trigger' ? 'trigger.path' : 'state.path'}
            />
          </div>
        );
      default:
        return null;
    }
  };

  const renderBindingCard = (binding: DataBinding, targetPort?: TaskInputPort) => (
    <div key={binding.id} className="rounded-md border p-2 space-y-2">
      <div className="flex items-center gap-2">
        <div className="grid flex-1 grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">{t('dataBindingEditor.sourceKind')}</Label>
            <select
              value={binding.sourceKind}
              onChange={(event) => updateBinding(binding.id, { sourceKind: event.target.value as DataBindingSourceKind })}
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
            >
              {sourceKindOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('dataBindingEditor.targetPort')}</Label>
            <Input value={targetPort?.name ?? binding.targetPort} readOnly className="h-8 text-xs" />
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-destructive"
          onClick={() => removeBinding(binding.id)}
          title={t('dataBindingEditor.removeBinding')}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {renderSourceFields(binding, targetPort)}
    </div>
  );

  return (
    <div className="space-y-3 rounded-md border border-dashed p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">{t('dataBindingEditor.title')}</h4>
        <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => addBinding()}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t('dataBindingEditor.addBinding')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('dataBindingEditor.description')}</p>

      {targetNodeId && inputPorts.length > 0 ? (
        <div className="space-y-3">
          {inputPorts.map((port) => {
            const binding = bindingByPort.get(port.id);
            return (
              <div key={port.id} className="space-y-2 rounded-md border p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{port.name}</span>
                    <Badge variant="outline" className="text-[10px]">{port.artifactKind}</Badge>
                    {port.required ? <Badge variant="secondary" className="text-[10px]">{t('dataBindingEditor.required')}</Badge> : null}
                  </div>
                  {!binding ? (
                    <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => addBinding(port)}>
                      <Plus className="mr-1 h-3.5 w-3.5" />
                      {t('dataBindingEditor.bindPort')}
                    </Button>
                  ) : null}
                </div>
                {binding ? renderBindingCard(binding, port) : (
                  <p className="text-xs text-muted-foreground">{t('dataBindingEditor.unbound')}</p>
                )}
              </div>
            );
          })}

          {extraBindings.length > 0 ? (
            <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-2">
              <div className="text-xs font-medium text-destructive">{t('dataBindingEditor.unmappedTitle')}</div>
              {extraBindings.map((binding) => renderBindingCard(binding))}
            </div>
          ) : null}
        </div>
      ) : nodeBindings.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('dataBindingEditor.empty')}</p>
      ) : (
        <div className="space-y-3">
          {nodeBindings.map((binding) => renderBindingCard(binding))}
        </div>
      )}
    </div>
  );
}
