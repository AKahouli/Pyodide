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
      outputLabels: node.output_labels, maxIterations: node.max_iterations || 5,
    } : undefined,
    metadata: node.assigned_agent_id ? { assignedAgentId: node.assigned_agent_id } : {},
  }));

  const controlEdges = grpcEdges.map((edge: any, idx: number) => ({
    id: `edge-${idx}`,
    kind: edge.kind || 'sequential',
    source: edge.source_id || edge.source,
    target: edge.target_id || edge.target,
    routerLabel: edge.router_label || undefined,
  }));

  const dataBindings: any[] = [];

  return { nodes, controlEdges, dataBindings };
}
