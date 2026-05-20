import { useCallback, useMemo } from 'react';
import { AlertTriangle, ArrowRight, Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useModuleTranslation } from '@/modules/localization';

import { useCurrentPlaybook, usePlaybookStore } from '../store';
import type { ArtifactKind, DataBinding, DataBindingSourceKind, PlaybookTask, TaskInputPort, TaskOutputPort } from '../types';
import { isDataBindingResolved } from '../utils/required-port-validation';

interface Props {
  targetNodeId?: string;
  inputPortsOverride?: TaskInputPort[];
  onInputPortsChange?: (ports: TaskInputPort[]) => void;
  canEditPorts?: boolean;
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

const ARTIFACT_KINDS: ArtifactKind[] = ['text', 'document', 'code', 'image', 'data', 'dashboard'];

function getBindingPatchForSourceKind(binding: DataBinding, sourceKind: DataBindingSourceKind): Partial<DataBinding> {
  switch (sourceKind) {
    case 'node-output':
      return {
        sourceKind,
        sourceNode: binding.sourceKind === 'node-output' ? binding.sourceNode : undefined,
        sourcePort: binding.sourceKind === 'node-output' ? binding.sourcePort : undefined,
        triggerPath: undefined,
        statePath: undefined,
        constantValue: undefined,
        expression: undefined,
      };
    case 'trigger':
      return {
        sourceKind,
        sourceNode: undefined,
        sourcePort: undefined,
        triggerPath: undefined,
        statePath: undefined,
        constantValue: undefined,
        expression: undefined,
      };
    case 'state':
      return {
        sourceKind,
        sourceNode: undefined,
        sourcePort: undefined,
        triggerPath: undefined,
        statePath: binding.sourceKind === 'state' ? binding.statePath : undefined,
        constantValue: undefined,
        expression: undefined,
      };
    case 'constant':
      return {
        sourceKind,
        sourceNode: undefined,
        sourcePort: undefined,
        triggerPath: undefined,
        statePath: undefined,
        constantValue: binding.sourceKind === 'constant' ? binding.constantValue : undefined,
        expression: undefined,
      };
    case 'expression':
      return {
        sourceKind,
        sourceNode: undefined,
        sourcePort: undefined,
        triggerPath: undefined,
        statePath: undefined,
        constantValue: undefined,
        expression: binding.sourceKind === 'expression' ? binding.expression : undefined,
      };
    default:
      return { sourceKind };
  }
}

export function PlaybookDataBindingSection({ targetNodeId, inputPortsOverride, onInputPortsChange, canEditPorts = true }: Props) {
  const { t } = useModuleTranslation('playbook');
  const playbook = useCurrentPlaybook();
  const updateDataBindings = usePlaybookStore((s) => s.updateDataBindings);

  const allBindings = playbook?.dataBindings ?? [];
  const allTasks = playbook?.tasks ?? [];
  const targetNode = targetNodeId ? allTasks.find((task) => task.id === targetNodeId) : undefined;
  const inputPorts = inputPortsOverride ?? targetNode?.inputPorts ?? [];
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

  const updateBinding = useCallback((id: string, patch: Partial<DataBinding>) => {
    const existingBinding = allBindings.find((binding) => binding.id === id);
    if (!existingBinding) return;

    updateDataBindings(
      allBindings.map((binding) => (binding.id === id ? { ...existingBinding, ...patch } : binding)),
    );
  }, [allBindings, updateDataBindings]);

  const removeBinding = useCallback((id: string) => {
    updateDataBindings(allBindings.filter((binding) => binding.id !== id));
  }, [allBindings, updateDataBindings]);

  const createBinding = useCallback((portId: string, sourceKind: DataBindingSourceKind) => {
    const nextBinding: DataBinding = {
      id: `db-${crypto.randomUUID().slice(0, 8)}`,
      targetNode: targetNodeId ?? '',
      targetPort: portId,
      sourceKind,
    };
    updateDataBindings([...allBindings, nextBinding]);
  }, [allBindings, targetNodeId, updateDataBindings]);

  const updateInputPort = useCallback((portId: string, patch: Partial<TaskInputPort>) => {
    if (!onInputPortsChange) return;
    onInputPortsChange(inputPorts.map((port) => (port.id === portId ? { ...port, ...patch } : port)));
  }, [inputPorts, onInputPortsChange]);

  const addInputPort = useCallback(() => {
    if (!onInputPortsChange) return;
    const id = `in-${crypto.randomUUID().slice(0, 8)}`;
    onInputPortsChange([
      ...inputPorts,
      { id, name: t('nodeEditor.portDefaultInput'), artifactKind: 'text', required: false },
    ]);
  }, [inputPorts, onInputPortsChange, t]);

  const removeInputPort = useCallback((portId: string) => {
    if (!onInputPortsChange) return;
    onInputPortsChange(inputPorts.filter((port) => port.id !== portId));
  }, [inputPorts, onInputPortsChange]);

  const renderSourceFields = (binding: DataBinding, targetPort?: TaskInputPort) => {
    switch (binding.sourceKind) {
      case 'node-output':
        return (
          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <select
                aria-label={t('dataBindingEditor.sourceNode')}
                value={binding.sourceNode ?? ''}
                onChange={(event) => {
                  const sourceNode = event.target.value || undefined;
                  const nextSourcePort = getSourcePortOptions(allTasks, sourceNode)
                    .find((port) => port.artifactKind === targetPort?.artifactKind)?.id
                    ?? getSourcePortOptions(allTasks, sourceNode)[0]?.id;
                  updateBinding(binding.id, { sourceNode, sourcePort: nextSourcePort });
                }}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                name={`binding-${binding.id}-source-node`}
              >
                <option value="">{t('dataBindingEditor.selectNode')}</option>
                {sourceNodeOptions.map((task) => (
                  <option key={task.id} value={task.id}>{task.title}</option>
                ))}
              </select>
            </div>
            <div>
              <select
                aria-label={t('dataBindingEditor.sourcePort')}
                value={binding.sourcePort ?? ''}
                onChange={(event) => updateBinding(binding.id, { sourcePort: event.target.value || undefined })}
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
                name={`binding-${binding.id}-source-port`}
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
          <div>
            <Input
              aria-label={t('dataBindingEditor.constantValue')}
              value={
                typeof binding.constantValue === 'string'
                  ? binding.constantValue
                  : (binding.constantValue as Record<string, unknown>)?.text?.toString() ?? ''
              }
              onChange={(event) => updateBinding(binding.id, {
                constantValue: event.target.value ? { text: event.target.value } : undefined,
              })}
              className="h-8 text-xs"
              placeholder="value"
              name={`binding-${binding.id}-constant`}
            />
          </div>
        );
      case 'expression':
        return (
          <div>
            <Input
              aria-label={t('dataBindingEditor.expression')}
              value={binding.expression ?? ''}
              onChange={(event) => updateBinding(binding.id, { expression: event.target.value || undefined })}
              className="h-8 text-xs"
              placeholder="{{item.name}}"
              name={`binding-${binding.id}-expression`}
            />
          </div>
        );
      case 'trigger':
      case 'state':
        return (
          <div>
            <Input
              aria-label={binding.sourceKind === 'trigger' ? t('dataBindingEditor.triggerPath') : t('dataBindingEditor.statePath')}
              value={binding.sourceKind === 'trigger' ? binding.triggerPath ?? '' : binding.statePath ?? ''}
              onChange={(event) => updateBinding(
                binding.id,
                binding.sourceKind === 'trigger'
                  ? { triggerPath: event.target.value || undefined }
                  : { statePath: event.target.value || undefined },
              )}
              className="h-8 text-xs"
              placeholder={binding.sourceKind === 'trigger' ? 'trigger.path' : 'state.path'}
              name={`binding-${binding.id}-${binding.sourceKind}-path`}
            />
          </div>
        );
      default:
        return null;
    }
  };

  if (!targetNodeId && nodeBindings.length === 0) {
    return <p className="text-xs text-muted-foreground">{t('dataBindingEditor.empty')}</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium">{t('dataBindingEditor.title')}</h4>
          <p className="text-xs text-muted-foreground">{t('dataBindingEditor.description')}</p>
        </div>
        {onInputPortsChange && canEditPorts ? (
          <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={addInputPort}>
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t('ports.addInput')}
          </Button>
        ) : null}
      </div>

      {inputPorts.length > 0 ? (
        <div className="space-y-4">
          <div className="hidden items-center gap-3 lg:grid lg:grid-cols-[160px_minmax(260px,1.4fr)_32px_minmax(220px,1fr)_140px_140px_56px]">
            <div className="text-[11px] font-medium text-muted-foreground">{t('dataBindingEditor.sourceKind')}</div>
            <div className="text-[11px] font-medium text-muted-foreground">{t('dataBindingEditor.description')}</div>
            <div />
            <div className="text-[11px] font-medium text-muted-foreground">{t('dataBindingEditor.portLabel')}</div>
            <div className="text-[11px] font-medium text-muted-foreground">{t('dataBindingEditor.portType')}</div>
            <div className="text-[11px] font-medium text-muted-foreground">{t('dataBindingEditor.portRequirement')}</div>
            <div />
          </div>
          {inputPorts.map((port) => {
            const binding = bindingByPort.get(port.id);
            const isResolvedBinding = binding ? isDataBindingResolved(binding) : false;
            const isMissingRequiredBinding = port.required && !isResolvedBinding;

            return (
              <div key={port.id} className="rounded-lg border bg-background p-4">
                <div className="grid gap-3 lg:grid-cols-[160px_minmax(260px,1.4fr)_32px_minmax(220px,1fr)_140px_140px_56px] lg:items-center">
                  <div className="space-y-1 lg:space-y-0">
                    <Label className="text-xs lg:sr-only">{t('dataBindingEditor.sourceKind')}</Label>
                    <select
                      aria-label={t('dataBindingEditor.sourceKind')}
                      value={binding?.sourceKind ?? ''}
                      onChange={(event) => {
                        const nextKind = event.target.value as DataBindingSourceKind | '';
                        if (!nextKind) {
                          if (binding) removeBinding(binding.id);
                          return;
                        }
                        if (binding) {
                          updateBinding(binding.id, getBindingPatchForSourceKind(binding, nextKind));
                          return;
                        }
                        createBinding(port.id, nextKind);
                      }}
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                      name={`port-${port.id}-source-kind`}
                    >
                      <option value="">{t('dataBindingEditor.unbound')}</option>
                      {sourceKindOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1 lg:space-y-0">
                    <Label className="text-xs lg:sr-only">{t('dataBindingEditor.description')}</Label>
                    {binding ? (
                      <div className="rounded-md border border-dashed p-2">
                        {renderSourceFields(binding, port)}
                      </div>
                    ) : (
                      <div className="flex h-9 items-center rounded-md border border-dashed px-3 text-xs text-muted-foreground">
                        {t('dataBindingEditor.unbound')}
                      </div>
                    )}
                  </div>
                  <div className="hidden justify-center lg:flex">
                    <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  </div>
                  <div className="space-y-1 lg:space-y-0">
                    <div className="flex items-center gap-1.5 lg:min-h-0">
                      <Label className="text-xs lg:sr-only">{t('dataBindingEditor.portLabel')}</Label>
                      {isMissingRequiredBinding ? (
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" aria-label={t('node.unboundRequiredPort')} />
                      ) : null}
                    </div>
                    <Input
                      aria-label={t('dataBindingEditor.portLabel')}
                      value={port.name}
                      disabled={!canEditPorts}
                      onChange={(event) => updateInputPort(port.id, { name: event.target.value })}
                      className="h-9 text-sm"
                      placeholder={t('ports.portName')}
                      name={`port-${port.id}-label`}
                    />
                  </div>
                  <div className="space-y-1 lg:space-y-0">
                    <Label className="text-xs lg:sr-only">{t('dataBindingEditor.portType')}</Label>
                    <select
                      aria-label={t('dataBindingEditor.portType')}
                      value={port.artifactKind}
                      disabled={!canEditPorts}
                      onChange={(event) => updateInputPort(port.id, { artifactKind: event.target.value as ArtifactKind })}
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs"
                      name={`port-${port.id}-type`}
                    >
                      {ARTIFACT_KINDS.map((kind) => (
                        <option key={kind} value={kind}>{t(`artifactKind.${kind}`)}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1 lg:space-y-0">
                    <Label className="text-xs lg:sr-only">{t('dataBindingEditor.portRequirement')}</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 w-full justify-center text-xs"
                      disabled={!canEditPorts}
                      onClick={() => updateInputPort(port.id, { required: !port.required })}
                    >
                      {port.required ? t('ports.required') : t('ports.optional')}
                    </Button>
                  </div>
                  <div className="space-y-1 lg:space-y-0">
                    <Label className="text-xs lg:sr-only">{t('ports.removePort')}</Label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 w-9 p-0 text-muted-foreground hover:text-destructive"
                      disabled={!canEditPorts}
                      onClick={() => removeInputPort(port.id)}
                      title={t('ports.removePort')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t('dataBindingEditor.empty')}</p>
      )}

      {extraBindings.length > 0 ? (
        <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-2">
          <div className="text-xs font-medium text-destructive">{t('dataBindingEditor.unmappedTitle')}</div>
          {extraBindings.map((binding) => (
            <div key={binding.id} className="flex items-center justify-between gap-2 rounded-md border border-destructive/30 bg-background p-2 text-xs text-muted-foreground">
              <span className="truncate">{binding.targetPort}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-7 shrink-0 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeBinding(binding.id)}
                title={t('ports.removePort')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
