import { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  GripVertical,
  Link2,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useModuleTranslation } from '@/modules/localization';
import type { TranslationParams } from '@/modules/localization/types';
import { useCurrentPlaybook, usePlaybookStore } from '../store';
import type {
  ArtifactKind,
  DataBinding,
  DataBindingSourceKind,
  PlaybookTask,
  TaskInputPort,
  TaskOutputPort,
} from '../types';
import { PORT_COLORS } from '../utils/port-colors';
import { isDataBindingResolved } from '../utils/required-port-validation';
import { getPortColor } from '../utils/port-colors';
import { hasArtifactKindMismatch, createCompatibleInputPort } from '../utils/port-compatibility';
import { ArtifactKindMismatchDialog } from './ArtifactKindMismatchDialog';

type TFunction = (key: string, params?: TranslationParams) => string;

interface Props {
  targetNodeId?: string;
  inputPortsOverride?: TaskInputPort[];
  outputPortsOverride?: TaskOutputPort[];
  onInputPortsChange?: (ports: TaskInputPort[]) => void;
  onOutputPortsChange?: (ports: TaskOutputPort[]) => void;
  canEditPorts?: boolean;
  showOutputPorts?: boolean;
  canEditOutputPortNames?: boolean;
  canEditOutputPortKinds?: boolean;
  canModifyOutputPorts?: boolean;
}

const ARTIFACT_KINDS: ArtifactKind[] = ['text', 'document', 'code', 'image', 'data', 'dashboard'];

function canReachTarget(
  fromId: string,
  targetId: string,
  edges: Array<{ sourceId: string; targetId: string }>,
): boolean {
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

function getSourcePortOptions(
  tasks: PlaybookTask[],
  sourceNodeId?: string,
): TaskOutputPort[] {
  if (!sourceNodeId) return [];
  return tasks.find((task) => task.id === sourceNodeId)?.outputPorts ?? [];
}

function getBindingPatchForSourceKind(
  binding: DataBinding,
  sourceKind: DataBindingSourceKind,
): Partial<DataBinding> {
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

function formatConstantSourceLabel(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value || fallback;
  if (Array.isArray(value)) {
    const labels = value
      .map((item) => formatConstantSourceLabel(item, ''))
      .filter(Boolean);
    return labels.length > 0 ? labels.join(', ') : fallback;
  }
  if (typeof value !== 'object' || value === null) return fallback;

  const record = value as Record<string, unknown>;
  const candidate = record.label
    ?? record.name
    ?? record.workspaceName
    ?? record.path
    ?? record.text;
  return typeof candidate === 'string' && candidate.trim() ? candidate : fallback;
}

function KindBadge({ kind }: { kind: ArtifactKind }) {
  const colors = PORT_COLORS[kind];
  if (!colors) return null;
  const Icon = colors.icon;
  return (
    <span
      className="inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[10px] font-medium"
      style={{ backgroundColor: `${colors.raw}18`, color: colors.raw }}
    >
      <Icon className="h-3 w-3" />
    </span>
  );
}

function ConnectionArrow({ active }: { active: boolean }) {
  return (
    <div className="flex items-center justify-center" style={{ minWidth: 32 }}>
      <ArrowRight
        className={cn(
          'h-4 w-4',
          active ? 'text-primary' : 'text-muted-foreground/30',
        )}
      />
    </div>
  );
}

export function PlaybookDataFlowSection({
  targetNodeId,
  inputPortsOverride,
  outputPortsOverride,
  onInputPortsChange,
  onOutputPortsChange,
  canEditPorts = true,
  showOutputPorts = true,
  canEditOutputPortNames = true,
  canEditOutputPortKinds = true,
  canModifyOutputPorts = true,
}: Props) {
  const { t: rawT } = useModuleTranslation('playbook');
  const t = rawT as TFunction;
  const playbook = useCurrentPlaybook();
  const updateDataBindings = usePlaybookStore((s) => s.updateDataBindings);

  const allBindings = playbook?.dataBindings ?? [];
  const allTasks = playbook?.tasks ?? [];
  const targetNode = targetNodeId
    ? allTasks.find((task) => task.id === targetNodeId)
    : undefined;
  const inputPorts = inputPortsOverride ?? targetNode?.inputPorts ?? [];
  const outputPorts = outputPortsOverride ?? targetNode?.outputPorts ?? [];

  const nodeBindings = targetNodeId
    ? allBindings.filter((b) => b.targetNode === targetNodeId)
    : allBindings;

  const bindingByPort = useMemo(
    () => new Map(nodeBindings.map((b) => [b.targetPort, b])),
    [nodeBindings],
  );

  const sourceNodeOptions = useMemo(
    () =>
      allTasks.filter((task) => {
        if (task.id === targetNodeId || (task.outputPorts?.length ?? 0) === 0) return false;
        if (!targetNodeId) return true;
        return canReachTarget(task.id, targetNodeId, playbook?.edges ?? []);
      }),
    [allTasks, playbook?.edges, targetNodeId],
  );

  const availableSources = useMemo(() => {
    const sources: Array<{
      taskId: string;
      taskTitle: string;
      portId: string;
      portName: string;
      artifactKind: ArtifactKind;
    }> = [];
    for (const task of sourceNodeOptions) {
      for (const port of task.outputPorts ?? []) {
        sources.push({
          taskId: task.id,
          taskTitle: task.title,
          portId: port.id,
          portName: port.name,
          artifactKind: port.artifactKind,
        });
      }
    }
    return sources;
  }, [sourceNodeOptions]);

  const updateBinding = useCallback(
    (id: string, patch: Partial<DataBinding>) => {
      const existing = allBindings.find((b) => b.id === id);
      if (!existing) return;
      updateDataBindings(
        allBindings.map((b) => (b.id === id ? { ...existing, ...patch } : b)),
      );
    },
    [allBindings, updateDataBindings],
  );

  const removeBinding = useCallback(
    (id: string) => {
      updateDataBindings(allBindings.filter((b) => b.id !== id));
    },
    [allBindings, updateDataBindings],
  );

  const createBinding = useCallback(
    (portId: string, sourceKind: DataBindingSourceKind) => {
      const next: DataBinding = {
        id: `db-${crypto.randomUUID().slice(0, 8)}`,
        targetNode: targetNodeId ?? '',
        targetPort: portId,
        sourceKind,
      };
      updateDataBindings([...allBindings, next]);
    },
    [allBindings, targetNodeId, updateDataBindings],
  );

  const [pendingDataFlowMismatch, setPendingDataFlowMismatch] = useState<{
    inputPort: TaskInputPort;
    source: { taskId: string; portId: string; portName: string; artifactKind: ArtifactKind };
  } | null>(null);

  const commitNodeOutputBinding = useCallback(
    (portId: string, sourceTaskId: string, sourcePortId: string) => {
      const existing = bindingByPort.get(portId);
      const binding: DataBinding = existing
        ? {
            ...existing,
            sourceKind: 'node-output',
            sourceNode: sourceTaskId,
            sourcePort: sourcePortId,
          }
        : {
            id: `db-${crypto.randomUUID().slice(0, 8)}`,
            targetNode: targetNodeId ?? '',
            targetPort: portId,
            sourceKind: 'node-output',
            sourceNode: sourceTaskId,
            sourcePort: sourcePortId,
          };
      if (existing) {
        updateDataBindings(
          allBindings.map((b) => (b.id === existing.id ? binding : b)),
        );
      } else {
        updateDataBindings([...allBindings, binding]);
      }
    },
    [allBindings, bindingByPort, targetNodeId, updateDataBindings],
  );

  const connectToNodeOutput = useCallback(
    (portId: string, sourceTaskId: string, sourcePortId: string) => {
      const inputPort = inputPorts.find((p) => p.id === portId);
      const sourceTask = allTasks.find((t) => t.id === sourceTaskId);
      const sourceOutputPort = sourceTask?.outputPorts?.find((p) => p.id === sourcePortId);

      if (inputPort && sourceOutputPort && hasArtifactKindMismatch(sourceOutputPort.artifactKind, inputPort.artifactKind)) {
        setPendingDataFlowMismatch({
          inputPort,
          source: { taskId: sourceTaskId, portId: sourcePortId, portName: sourceOutputPort.name || sourceOutputPort.id, artifactKind: sourceOutputPort.artifactKind },
        });
        return;
      }

      commitNodeOutputBinding(portId, sourceTaskId, sourcePortId);
    },
    [allTasks, inputPorts, commitNodeOutputBinding],
  );

  const updateInputPort = useCallback(
    (portId: string, patch: Partial<TaskInputPort>) => {
      if (!onInputPortsChange) return;
      onInputPortsChange(
        inputPorts.map((p) => (p.id === portId ? { ...p, ...patch } : p)),
      );
    },
    [inputPorts, onInputPortsChange],
  );

  const addInputPort = useCallback(() => {
    if (!onInputPortsChange) return;
    const id = `in-${crypto.randomUUID().slice(0, 8)}`;
    onInputPortsChange([
      ...inputPorts,
      { id, name: t('dataFlow.defaultInput'), artifactKind: 'text', required: false },
    ]);
  }, [inputPorts, onInputPortsChange, t]);

  const removeInputPort = useCallback(
    (portId: string) => {
      if (!onInputPortsChange) return;
      onInputPortsChange(inputPorts.filter((p) => p.id !== portId));
    },
    [inputPorts, onInputPortsChange],
  );

  const addOutputPort = useCallback(() => {
    if (!onOutputPortsChange) return;
    const id = `out-${crypto.randomUUID().slice(0, 8)}`;
    onOutputPortsChange([
      ...outputPorts,
      { id, name: t('dataFlow.defaultOutput'), artifactKind: 'text' },
    ]);
  }, [outputPorts, onOutputPortsChange, t]);

  const removeOutputPort = useCallback(
    (portId: string) => {
      if (!onOutputPortsChange) return;
      onOutputPortsChange(outputPorts.filter((p) => p.id !== portId));
    },
    [outputPorts, onOutputPortsChange],
  );

  const updateOutputPort = useCallback(
    (portId: string, patch: Partial<TaskOutputPort>) => {
      if (!onOutputPortsChange) return;
      onOutputPortsChange(
        outputPorts.map((p) => (p.id === portId ? { ...p, ...patch } : p)),
      );
    },
    [outputPorts, onOutputPortsChange],
  );

  if (!targetNodeId && nodeBindings.length === 0) {
    return <p className="text-xs text-muted-foreground">{t('dataFlow.empty')}</p>;
  }

  const maxRows = Math.max(inputPorts.length, showOutputPorts ? outputPorts.length : 0, 1);
  const gridClassName = showOutputPorts
    ? 'grid grid-cols-[1fr_auto_1fr_auto_1fr] gap-0'
    : 'grid grid-cols-[1fr_auto_1fr] gap-0';
  const rowClassName = showOutputPorts
    ? 'grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center border-b border-border/40'
    : 'grid grid-cols-[1fr_auto_1fr] items-center border-b border-border/40';
  const dataRowsColSpanClassName = showOutputPorts ? 'col-span-5' : 'col-span-3';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium">{t('dataFlow.title')}</h4>
          <p className="text-xs text-muted-foreground">{t('dataFlow.subtitle')}</p>
        </div>
      </div>

      <div className={gridClassName}>
        {/* Column headers */}
        <div className="rounded-t-lg bg-blue-500/8 px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-600">
            {t('dataFlow.sourcesColumn')}
          </span>
        </div>
        <div className="w-8" />
        <div className="rounded-t-lg bg-emerald-500/8 px-3 py-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-600">
            {t('dataFlow.inputsColumn')}
          </span>
        </div>
        {showOutputPorts ? (
          <>
            <div className="w-8" />
            <div className="rounded-t-lg bg-amber-500/8 px-3 py-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-600">
                {t('dataFlow.outputsColumn')}
              </span>
            </div>
          </>
        ) : null}

        {/* Data rows */}
        <div className={dataRowsColSpanClassName}>
          {Array.from({ length: maxRows }).map((_, rowIdx) => {
            const inputPort = inputPorts[rowIdx];
            const outputPort = showOutputPorts ? outputPorts[rowIdx] : undefined;
            const binding = inputPort ? bindingByPort.get(inputPort.id) : undefined;
            const isResolved = binding ? isDataBindingResolved(binding) : false;
            const isMissingRequired = inputPort?.required && !isResolved;

            return (
              <div
                key={rowIdx}
                className={rowClassName}
              >
                {/* Source column */}
                <div className="px-3 py-2.5">
                  {inputPort && (
                    <SourceCell
                      binding={binding}
                      inputPort={inputPort}
                      sourceNodeOptions={sourceNodeOptions}
                      availableSources={availableSources}
                      allTasks={allTasks}
                      onCreateBinding={createBinding}
                      onUpdateBinding={updateBinding}
                      onRemoveBinding={removeBinding}
                      onConnectToNodeOutput={connectToNodeOutput}
                      t={t}
                    />
                  )}
                </div>

                <ConnectionArrow active={Boolean(binding && isResolved)} />

                {/* Input column */}
                <div className="px-3 py-2.5">
                  {inputPort && (
                    <InputPortCell
                      port={inputPort}
                      canEdit={canEditPorts}
                      isMissingRequired={isMissingRequired}
                      onUpdate={updateInputPort}
                      onRemove={removeInputPort}
                      t={t}
                    />
                  )}
                </div>

                {showOutputPorts ? (
                  <>
                    <div className="w-8" />

                    {/* Output column */}
                    <div className="px-3 py-2.5">
                      {outputPort && (
                        <OutputPortCell
                          port={outputPort}
                          canEditName={canEditPorts && canEditOutputPortNames}
                          canEditKind={canEditPorts && canEditOutputPortKinds}
                          canRemove={canEditPorts && canModifyOutputPorts}
                          onUpdate={updateOutputPort}
                          onRemove={removeOutputPort}
                          t={t}
                        />
                      )}
                    </div>
                  </>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Add buttons row */}
        <div className="px-3 py-2">
          {canEditPorts && onInputPortsChange && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-blue-600 hover:text-blue-700"
              onClick={addInputPort}
            >
              <Plus className="mr-1 h-3.5 w-3.5" />
              {t('dataFlow.addInput')}
            </Button>
          )}
        </div>
        {showOutputPorts ? (
          <>
            <div className="w-8" />
            <div />
            <div className="w-8" />
            <div className="px-3 py-2">
              {canEditPorts && canModifyOutputPorts && onOutputPortsChange && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-amber-600 hover:text-amber-700"
                  onClick={addOutputPort}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  {t('dataFlow.addOutput')}
                </Button>
              )}
            </div>
          </>
        ) : null}
      </div>

      {pendingDataFlowMismatch && (
        <ArtifactKindMismatchDialog
          open
          onOpenChange={(open) => { if (!open) setPendingDataFlowMismatch(null); }}
          sourcePortName={pendingDataFlowMismatch.source.portName}
          sourceArtifactKind={pendingDataFlowMismatch.source.artifactKind}
          targetPortName={pendingDataFlowMismatch.inputPort.name || pendingDataFlowMismatch.inputPort.id}
          targetArtifactKind={pendingDataFlowMismatch.inputPort.artifactKind}
          canModifyPorts={Boolean(canEditPorts && onInputPortsChange)}
          onCreateCompatibleInput={() => {
            const source = pendingDataFlowMismatch.source;
            const newPort = createCompatibleInputPort(source.portName, source.artifactKind);
            onInputPortsChange?.([...inputPorts, newPort]);
            commitNodeOutputBinding(newPort.id, source.taskId, source.portId);
            setPendingDataFlowMismatch(null);
          }}
          onUpdateExistingInput={() => {
            const { inputPort, source } = pendingDataFlowMismatch;
            updateInputPort(inputPort.id, { artifactKind: source.artifactKind });
            commitNodeOutputBinding(inputPort.id, source.taskId, source.portId);
            setPendingDataFlowMismatch(null);
          }}
        />
      )}
    </div>
  );
}

/* ─── Source Cell ─── */

interface SourceCellProps {
  binding: DataBinding | undefined;
  inputPort: TaskInputPort;
  sourceNodeOptions: PlaybookTask[];
  availableSources: Array<{
    taskId: string;
    taskTitle: string;
    portId: string;
    portName: string;
    artifactKind: ArtifactKind;
  }>;
  allTasks: PlaybookTask[];
  onCreateBinding: (portId: string, sourceKind: DataBindingSourceKind) => void;
  onUpdateBinding: (id: string, patch: Partial<DataBinding>) => void;
  onRemoveBinding: (id: string) => void;
  onConnectToNodeOutput: (portId: string, sourceTaskId: string, sourcePortId: string) => void;
  t: TFunction;
}

function SourceCell({
  binding,
  inputPort,
  sourceNodeOptions,
  availableSources,
  allTasks,
  onCreateBinding,
  onUpdateBinding,
  onRemoveBinding,
  onConnectToNodeOutput,
  t,
}: SourceCellProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  if (pickerOpen) {
    return (
      <SourcePicker
        inputPort={inputPort}
        availableSources={availableSources}
        sourceNodeOptions={sourceNodeOptions}
        binding={binding ?? null}
        allTasks={allTasks}
        onConnect={onConnectToNodeOutput}
        onCreateBinding={onCreateBinding}
        onUpdateBinding={onUpdateBinding}
        onClose={() => setPickerOpen(false)}
        t={t}
      />
    );
  }

  if (!binding) {
    return (
      <button
        type="button"
        onClick={() => setPickerOpen(true)}
        className="flex w-full items-center gap-2 rounded-lg border border-dashed border-muted-foreground/30 bg-muted/20 px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary"
      >
        <Link2 className="h-3.5 w-3.5" />
        {t('dataFlow.connectSource')}
      </button>
    );
  }

  const isResolved = isDataBindingResolved(binding);

  return (
    <div
      className={cn(
        'group relative flex items-center gap-2 rounded-lg border px-3 py-2 text-xs',
        isResolved
          ? 'border-blue-500/20 bg-blue-500/5'
          : 'border-muted-foreground/20 bg-muted/20',
      )}
    >
      {binding.sourceKind === 'node-output' && binding.sourceNode && (
        <>
          <div className="h-2 w-2 rounded-full bg-blue-500" />
          <span className="font-medium text-foreground">
            {allTasks.find((t) => t.id === binding.sourceNode)?.title ?? t('dataFlow.unknownSource')}
          </span>
          {binding.sourcePort && (
            <>
              <span className="text-muted-foreground">→</span>
              <span className="text-muted-foreground">
                {getSourcePortOptions(allTasks, binding.sourceNode).find((p) => p.id === binding.sourcePort)?.name ?? binding.sourcePort}
              </span>
            </>
          )}
        </>
      )}
      {binding.sourceKind === 'constant' && (
        <>
          <div className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="font-medium text-foreground">
            {formatConstantSourceLabel(binding.constantValue, t('dataFlow.constantValue'))}
          </span>
        </>
      )}
      {binding.sourceKind === 'expression' && (
        <>
          <div className="h-2 w-2 rounded-full bg-purple-500" />
          <span className="font-mono text-xs text-purple-700">{binding.expression}</span>
        </>
      )}
      {(binding.sourceKind === 'trigger' || binding.sourceKind === 'state') && (
        <>
          <div className="h-2 w-2 rounded-full bg-orange-500" />
          <span className="font-medium text-foreground">
            {binding.sourceKind === 'trigger'
              ? t('dataBindingEditor.trigger')
              : t('dataBindingEditor.state')}
          </span>
          {(binding.triggerPath || binding.statePath) && (
            <span className="text-muted-foreground">
              .{binding.triggerPath ?? binding.statePath}
            </span>
          )}
        </>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          title={t('dataFlow.changeSource')}
        >
          <Link2 className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => onRemoveBinding(binding.id)}
          className="rounded p-0.5 text-muted-foreground hover:text-destructive"
          title={t('dataFlow.removeConnection')}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

/* ─── Source Picker ─── */

interface SourcePickerProps {
  inputPort: TaskInputPort;
  availableSources: Array<{
    taskId: string;
    taskTitle: string;
    portId: string;
    portName: string;
    artifactKind: ArtifactKind;
  }>;
  sourceNodeOptions: PlaybookTask[];
  binding: DataBinding | null;
  allTasks: PlaybookTask[];
  onConnect: (portId: string, sourceTaskId: string, sourcePortId: string) => void;
  onCreateBinding: (portId: string, sourceKind: DataBindingSourceKind) => void;
  onUpdateBinding: (id: string, patch: Partial<DataBinding>) => void;
  onClose: () => void;
  t: TFunction;
}

function SourcePicker({
  inputPort,
  availableSources,
  sourceNodeOptions,
  binding,
  allTasks,
  onConnect,
  onCreateBinding,
  onUpdateBinding,
  onClose,
  t,
}: SourcePickerProps) {
  const [tab, setTab] = useState<'node' | 'other'>(
    availableSources.length > 0 ? 'node' : 'other',
  );
  const [constantValue, setConstantValue] = useState(
    binding && typeof binding.constantValue === 'string'
      ? binding.constantValue
      : formatConstantSourceLabel(binding?.constantValue, ''),
  );
  const [expressionValue, setExpressionValue] = useState(binding?.expression ?? '');
  const [pathValue, setPathValue] = useState(
    binding?.sourceKind === 'trigger' ? binding.triggerPath ?? '' : binding?.statePath ?? '',
  );

  const handleConstantSave = () => {
    if (binding) {
      const existingLabel = formatConstantSourceLabel(binding.constantValue, '');
      const shouldKeepStructuredValue = binding.sourceKind === 'constant'
        && typeof binding.constantValue === 'object'
        && binding.constantValue !== null
        && constantValue === existingLabel;
      const patch: Partial<DataBinding> = {
        sourceKind: 'constant',
        constantValue: shouldKeepStructuredValue ? binding.constantValue : constantValue ? { text: constantValue } : undefined,
        sourceNode: undefined,
        sourcePort: undefined,
        triggerPath: undefined,
        statePath: undefined,
        expression: undefined,
      };
      onUpdateBinding(binding.id, patch);
    } else {
      onCreateBinding(inputPort.id, 'constant');
    }
    onClose();
  };

  const handleExpressionSave = () => {
    if (binding) {
      const patch: Partial<DataBinding> = {
        sourceKind: 'expression',
        expression: expressionValue || undefined,
        sourceNode: undefined,
        sourcePort: undefined,
        triggerPath: undefined,
        statePath: undefined,
        constantValue: undefined,
      };
      onUpdateBinding(binding.id, patch);
    } else {
      onCreateBinding(inputPort.id, 'expression');
    }
    onClose();
  };

  const handlePathSave = (kind: 'trigger' | 'state') => {
    if (binding) {
      const patch: Partial<DataBinding> = {
        sourceKind: kind,
        sourceNode: undefined,
        sourcePort: undefined,
        constantValue: undefined,
        expression: undefined,
        ...(kind === 'trigger'
          ? { triggerPath: pathValue || undefined, statePath: undefined }
          : { statePath: pathValue || undefined, triggerPath: undefined }),
      };
      onUpdateBinding(binding.id, patch);
    } else {
      onCreateBinding(inputPort.id, kind);
    }
    onClose();
  };

  return (
    <div className="rounded-lg border border-primary/20 bg-background p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">
          {t('dataFlow.pickSourceFor', { port: inputPort.name })}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mb-3 flex gap-1">
        <button
          type="button"
          onClick={() => setTab('node')}
          className={cn(
            'rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors',
            tab === 'node'
              ? 'bg-blue-500/10 text-blue-700'
              : 'text-muted-foreground hover:bg-muted',
          )}
        >
          {t('dataFlow.fromStep')}
        </button>
        <button
          type="button"
          onClick={() => setTab('other')}
          className={cn(
            'rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors',
            tab === 'other'
              ? 'bg-blue-500/10 text-blue-700'
              : 'text-muted-foreground hover:bg-muted',
          )}
        >
          {t('dataFlow.otherSource')}
        </button>
      </div>

      {tab === 'node' && (
        <div className="max-h-48 space-y-1 overflow-y-auto">
          {availableSources.length === 0 ? (
            <p className="py-2 text-center text-xs text-muted-foreground">
              {t('dataFlow.noSourcesAvailable')}
            </p>
          ) : (
            availableSources.map((src) => (
              <button
                key={`${src.taskId}-${src.portId}`}
                type="button"
                onClick={() => {
                  onConnect(inputPort.id, src.taskId, src.portId);
                  onClose();
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
              >
                <KindBadge kind={src.artifactKind} />
                <span className="font-medium text-foreground">{src.taskTitle}</span>
                <span className="text-muted-foreground">→</span>
                <span className="text-muted-foreground">{src.portName}</span>
              </button>
            ))
          )}
        </div>
      )}

      {tab === 'other' && (
        <div className="space-y-3">
          <div>
            <Label className="mb-1.5 text-[11px] font-medium">
              {t('dataBindingEditor.constant')}
            </Label>
            <div className="flex gap-1.5">
              <Input
                value={constantValue}
                onChange={(e) => setConstantValue(e.target.value)}
                placeholder={t('dataFlow.constantPlaceholder')}
                className="h-8 text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 shrink-0 px-3 text-xs"
                onClick={handleConstantSave}
              >
                {t('dataFlow.apply')}
              </Button>
            </div>
          </div>

          <div>
            <Label className="mb-1.5 text-[11px] font-medium">
              {t('dataBindingEditor.expressionLabel')}
            </Label>
            <div className="flex gap-1.5">
              <Input
                value={expressionValue}
                onChange={(e) => setExpressionValue(e.target.value)}
                placeholder="{{item.name}}"
                className="h-8 font-mono text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 shrink-0 px-3 text-xs"
                onClick={handleExpressionSave}
              >
                {t('dataFlow.apply')}
              </Button>
            </div>
          </div>

          <div>
            <Label className="mb-1.5 text-[11px] font-medium">
              {t('dataBindingEditor.trigger')}
            </Label>
            <div className="flex gap-1.5">
              <Input
                value={pathValue}
                onChange={(e) => setPathValue(e.target.value)}
                placeholder="trigger.path"
                className="h-8 text-xs"
                onFocus={() => setPathValue(binding?.triggerPath ?? '')}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 shrink-0 px-3 text-xs"
                onClick={() => handlePathSave('trigger')}
              >
                {t('dataFlow.apply')}
              </Button>
            </div>
          </div>

          <div>
            <Label className="mb-1.5 text-[11px] font-medium">
              {t('dataBindingEditor.state')}
            </Label>
            <div className="flex gap-1.5">
              <Input
                value={pathValue}
                onChange={(e) => setPathValue(e.target.value)}
                placeholder="state.path"
                className="h-8 text-xs"
                onFocus={() => setPathValue(binding?.statePath ?? '')}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 shrink-0 px-3 text-xs"
                onClick={() => handlePathSave('state')}
              >
                {t('dataFlow.apply')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Input Port Cell ─── */

interface InputPortCellProps {
  port: TaskInputPort;
  canEdit: boolean;
  isMissingRequired: boolean;
  onUpdate: (portId: string, patch: Partial<TaskInputPort>) => void;
  onRemove: (portId: string) => void;
  t: TFunction;
}

function InputPortCell({ port, canEdit, isMissingRequired, onUpdate, onRemove, t }: InputPortCellProps) {
  const colors = PORT_COLORS[port.artifactKind];
  const Icon = colors?.icon;

  return (
    <div className="group flex items-center gap-2">
      {isMissingRequired && (
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
      )}
      <div
        className={cn('h-3 w-3 shrink-0 rounded-full', colors?.dot ?? 'bg-muted')}
      />
      <input
        type="text"
        value={port.name}
        disabled={!canEdit}
        onChange={(e) => onUpdate(port.id, { name: e.target.value })}
        className="min-w-0 flex-1 border-b border-transparent bg-transparent text-sm outline-none focus:border-primary disabled:opacity-60"
        placeholder={t('ports.portName')}
      />
      <select
        value={port.artifactKind}
        disabled={!canEdit}
        onChange={(e) =>
          onUpdate(port.id, { artifactKind: e.target.value as ArtifactKind })
        }
        className="h-7 rounded border bg-background px-1 text-xs disabled:opacity-60"
      >
        {ARTIFACT_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {t(`artifactKind.${kind}`)}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => onUpdate(port.id, { required: !port.required })}
        disabled={!canEdit}
        className={cn(
          'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors disabled:opacity-60',
          port.required
            ? 'border-amber-500/30 bg-amber-500/10 text-amber-700'
            : 'border-muted-foreground/20 bg-muted/30 text-muted-foreground',
        )}
      >
        {port.required ? t('ports.required') : t('ports.optional')}
      </button>
      {canEdit && (
        <button
          type="button"
          onClick={() => onRemove(port.id)}
          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
          title={t('ports.removePort')}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/* ─── Output Port Cell ─── */

interface OutputPortCellProps {
  port: TaskOutputPort;
  canEditName: boolean;
  canEditKind: boolean;
  canRemove: boolean;
  onUpdate: (portId: string, patch: Partial<TaskOutputPort>) => void;
  onRemove: (portId: string) => void;
  t: TFunction;
}

function OutputPortCell({ port, canEditName, canEditKind, canRemove, onUpdate, onRemove, t }: OutputPortCellProps) {
  const colors = PORT_COLORS[port.artifactKind];

  return (
    <div className="group flex items-center gap-2">
      <div
        className={cn('h-3 w-3 shrink-0 rounded-full', colors?.dot ?? 'bg-muted')}
      />
        <input
          type="text"
          value={port.name}
          disabled={!canEditName}
          onChange={(e) => onUpdate(port.id, { name: e.target.value })}
          className="min-w-0 flex-1 border-b border-transparent bg-transparent text-sm outline-none focus:border-primary disabled:opacity-60"
          placeholder={t('ports.portName')}
        />
        <select
          value={port.artifactKind}
          disabled={!canEditKind}
          onChange={(e) =>
            onUpdate(port.id, { artifactKind: e.target.value as ArtifactKind })
          }
          className="h-7 rounded border bg-background px-1 text-xs disabled:opacity-60"
        >
        {ARTIFACT_KINDS.map((kind) => (
          <option key={kind} value={kind}>
            {t(`artifactKind.${kind}`)}
          </option>
        ))}
      </select>
      {canRemove && (
        <button
          type="button"
          onClick={() => onRemove(port.id)}
          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
          title={t('ports.removePort')}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
