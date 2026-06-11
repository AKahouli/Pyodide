export function resolveCanvasNodeSelection(
  selectedNodeIds: ReadonlySet<string>,
  selectedNodeCount: number,
  nodeId: string,
  selectedStepId: string | null,
): boolean {
  return selectedNodeCount > 1
    ? selectedNodeIds.has(nodeId)
    : nodeId === selectedStepId;
}
