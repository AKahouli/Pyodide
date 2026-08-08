/**
 * Maps a gRPC GeneratePlaybook response to Flow nodes, control edges, and data bindings.
 */
export function mapGrpcResponseToFlow(response: any): {
  nodes: any[];
  controlEdges: any[];
  dataBindings: any[];
} {
  const grpcNodes: any[] = response.nodes || [];
  const grpcEdges: any[] = response.edges || [];

  const nodes = grpcNodes.map((node: any, idx: number) => ({
    id: node.id || `node-${idx}`,
    kind: node.kind || 'step',
    label: node.title || `Step ${idx + 1}`,
    description: node.description || undefined,
    taskTemplateId: node.task_type || undefined,
    promptTemplateId: node.prompt_template_id || undefined,
    outputFormatId: node.output_format_id || undefined,
    modelId: node.model_id || undefined,
    input: { ports: (node.input_ports || []).map((p: any) => ({
      id: p.id || `in-${idx}`, label: p.name || 'Input',
      type: p.artifact_kind || 'text', required: p.required ?? false,
    })) },
    output: { ports: (node.output_ports || []).map((p: any) => ({
      id: p.id || `out-${idx}`, label: p.name || 'Output',
      type: p.artifact_kind || 'text',
    })) },
    routerConfig: node.output_labels ? {
      outputLabels: node.output_labels,
      maxIterations: node.max_iterations || 5,
      conditions: (node.router_conditions || []).map((condition: any) => ({
        label: condition.label,
        sourceNode: condition.source_node || undefined,
        sourcePort: condition.source_port || undefined,
        path: condition.path || undefined,
        operator: condition.operator,
        value: condition.value,
      })),
      defaultLabel: node.default_label || undefined,
    } : undefined,
    metadata: node.assigned_agent_id ? { assignedAgentId: node.assigned_agent_id } : {},
  }));

  const controlEdges = grpcEdges.map((edge: any, idx: number) => ({
    id: `edge-${idx}`,
    kind: edge.kind || 'sequential',
    source: edge.source_id || edge.source,
    target: edge.target_id || edge.target,
    routerLabel: edge.router_label || undefined,
    sourceOutputPortId: edge.source_output_port_id || edge.router_label || undefined,
    targetInputPortId: edge.target_input_port_id || undefined,
  }));

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const dataBindings = nodes.flatMap((targetNode) =>
    (targetNode.input?.ports || [])
      .filter((targetPort: any) => targetPort.required)
      .flatMap((targetPort: any) => {
        const candidates = controlEdges.flatMap((edge) => {
          if (
            edge.kind !== 'sequential'
            || edge.target !== targetNode.id
            || (edge.targetInputPortId && edge.targetInputPortId !== targetPort.id)
          ) {
            return [];
          }

          const sourceNode = nodeById.get(edge.source);
          const sourcePorts = sourceNode?.output?.ports || [];
          let sourcePort = edge.sourceOutputPortId
            ? sourcePorts.find((port: any) => port.id === edge.sourceOutputPortId)
            : undefined;

          if (!edge.sourceOutputPortId) {
            const exact = sourcePorts.filter((port: any) => port.type === targetPort.type);
            if (exact.length === 1) {
              [sourcePort] = exact;
            }
          }

          if (!sourcePort || sourcePort.type !== targetPort.type) return [];
          return [{ sourceNode: edge.source, sourcePort: sourcePort.id }];
        });

        const uniqueCandidates = new Map(
          candidates.map((candidate) => [tupleKey(candidate.sourceNode, candidate.sourcePort), candidate]),
        );
        if (uniqueCandidates.size !== 1) return [];

        const candidate = [...uniqueCandidates.values()][0];
        return [{
          id: `binding-${tupleKey(candidate.sourceNode, candidate.sourcePort, targetNode.id, targetPort.id)}`,
          targetNode: targetNode.id,
          targetPort: targetPort.id,
          sourceKind: 'node-output',
          sourceNode: candidate.sourceNode,
          sourcePort: candidate.sourcePort,
          iteration: 'current',
        }];
      }),
  );

  return { nodes, controlEdges, dataBindings };
}

function tupleKey(...parts: string[]): string {
  return JSON.stringify(parts);
}
