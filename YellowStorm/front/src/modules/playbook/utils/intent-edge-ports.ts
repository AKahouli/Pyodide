import type { PlaybookEdge, PlaybookTask } from '../types';

export interface ResolvedIntentEdgePorts {
  sourceOutputPortId: string;
  targetInputPortId: string;
}

export function artifactKindsCompatible(sourceKind?: string | null, targetKind?: string | null): boolean {
  if (!sourceKind || !targetKind) {
    return true;
  }

  return sourceKind === targetKind;
}

export function getPreferredIntentInputPortId(task: PlaybookTask, index = 0): string {
  return task.inputPorts?.[index]?.id || task.inputPorts?.[0]?.id || 'default';
}

export function getPreferredIntentOutputPortId(task: PlaybookTask): string {
  return task.outputPorts?.[0]?.id || 'default';
}

export function resolveIntentEdgePorts(
  sourceTask: PlaybookTask,
  targetTask: PlaybookTask,
  suggestedSourceOutputPortId?: string | null,
  suggestedTargetInputPortId?: string | null,
): ResolvedIntentEdgePorts | null {
  const outputPorts = sourceTask.outputPorts || [];
  const inputPorts = targetTask.inputPorts || [];
  const suggestedOutput = outputPorts.find((port) => port.id === suggestedSourceOutputPortId) || null;
  const suggestedInput = inputPorts.find((port) => port.id === suggestedTargetInputPortId) || null;

  if (suggestedOutput && suggestedInput && artifactKindsCompatible(suggestedOutput.artifactKind, suggestedInput.artifactKind)) {
    return { sourceOutputPortId: suggestedOutput.id, targetInputPortId: suggestedInput.id };
  }

  if (suggestedOutput) {
    const compatibleInput = inputPorts.find((port) => artifactKindsCompatible(suggestedOutput.artifactKind, port.artifactKind)) || null;
    if (compatibleInput) {
      return { sourceOutputPortId: suggestedOutput.id, targetInputPortId: compatibleInput.id };
    }
  }

  if (suggestedInput) {
    const compatibleOutput = outputPorts.find((port) => artifactKindsCompatible(port.artifactKind, suggestedInput.artifactKind)) || null;
    if (compatibleOutput) {
      return { sourceOutputPortId: compatibleOutput.id, targetInputPortId: suggestedInput.id };
    }
  }

  for (const outputPort of outputPorts) {
    const compatibleInput = inputPorts.find((port) => artifactKindsCompatible(outputPort.artifactKind, port.artifactKind)) || null;
    if (compatibleInput) {
      return { sourceOutputPortId: outputPort.id, targetInputPortId: compatibleInput.id };
    }
  }

  if (outputPorts.length === 0 && inputPorts.length === 0) {
    return {
      sourceOutputPortId: 'default',
      targetInputPortId: 'default',
    };
  }

  if (outputPorts.length === 0) {
    return {
      sourceOutputPortId: 'default',
      targetInputPortId: suggestedInput?.id || getPreferredIntentInputPortId(targetTask),
    };
  }

  if (inputPorts.length === 0) {
    return {
      sourceOutputPortId: suggestedOutput?.id || getPreferredIntentOutputPortId(sourceTask),
      targetInputPortId: 'default',
    };
  }

  return null;
}

export function edgeMatchesIntentPortPair(
  edge: Pick<PlaybookEdge, 'sourceId' | 'targetId' | 'sourceOutputPortId' | 'targetInputPortId'>,
  sourceId: string,
  targetId: string,
  sourceOutputPortId?: string | null,
  targetInputPortId?: string | null,
): boolean {
  return edge.sourceId === sourceId
    && edge.targetId === targetId
    && (sourceOutputPortId == null || edge.sourceOutputPortId === sourceOutputPortId)
    && (targetInputPortId == null || edge.targetInputPortId === targetInputPortId);
}
