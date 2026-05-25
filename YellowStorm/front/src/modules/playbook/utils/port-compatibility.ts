import type { ArtifactKind, TaskInputPort } from '../types';

export function hasArtifactKindMismatch(
  sourceKind: ArtifactKind | undefined,
  targetKind: ArtifactKind | undefined,
): boolean {
  return Boolean(sourceKind && targetKind && sourceKind !== targetKind);
}

export function createCompatibleInputPort(
  sourcePortName: string,
  sourceArtifactKind: ArtifactKind,
): TaskInputPort {
  return {
    id: `in-${crypto.randomUUID().slice(0, 8)}`,
    name: sourcePortName,
    artifactKind: sourceArtifactKind,
    required: false,
  };
}
