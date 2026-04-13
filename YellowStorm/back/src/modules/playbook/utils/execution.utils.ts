import { extractComponentData } from '../../conversation/utils/component-mapper';

// ===== Constants =====

export const MAX_COMPONENT_DATA_BYTES_DEFAULT = 500_000;
export const MAX_COMPONENTS_PER_TASK_DEFAULT = 200;
export const MAX_CONCURRENT_STEPS_DEFAULT = 5;

// ===== Interfaces =====

export interface BufferedStepResult {
  taskId: string;
  status: string;
  output?: string;
  error?: string;
  components?: any[];
  toolTrace?: Array<{
    callIndex: number;
    toolName: string;
    args: Record<string, unknown>;
    outputSummary: string | null;
  }>;
  llmPromptTrace?: Array<{
    stage: string;
    model: string;
    prompt: string;
  }>;
  durationMs?: number;
  startedAt?: Date;
  completedAt?: Date;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  modelName?: string;
  semanticMatch?: {
    matchScore: number;
    semanticSimilarityScore: number;
    evidenceConsistencyScore: number;
    judgeScore: number;
    reason: string;
    missingPoints: string[];
    changedPoints: string[];
    model: string;
    judgeUsed: boolean;
  } | null;
  evaluationHistory?: Array<{
    id: string;
    createdAt: Date | string;
    attemptNumber: number | null;
    trigger: 'manual' | 'auto';
    baselineReplayId: string | null;
    baselineValidationVersion: number | null;
    semanticMatch: {
      matchScore: number;
      semanticSimilarityScore: number;
      evidenceConsistencyScore: number;
      judgeScore: number;
      reason: string;
      missingPoints: string[];
      changedPoints: string[];
      model: string;
      judgeUsed: boolean;
    };
  }>;
  stepExecutions?: Array<{
    id: string;
    attemptNumber: number | null;
    status: string;
    output: string | null;
    error: string | null;
    durationMs: number | null;
    startedAt: Date | string | null;
    completedAt: Date | string | null;
    components?: any[];
    toolTrace?: Array<{
      callIndex: number;
      toolName: string;
      args: Record<string, unknown>;
      outputSummary: string | null;
    }>;
    llmPromptTrace?: Array<{
      stage: string;
      model: string;
      prompt: string;
    }>;
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
    modelName?: string | null;
    artifacts?: Array<{
      portId: string;
      artifactKind: string;
      content?: string;
      url?: string;
      filename?: string;
      mimeType?: string;
      size?: number;
      metadata?: Record<string, unknown>;
    }>;
  }>;
  artifacts?: Array<{
    portId: string;
    artifactKind: string;
    content?: string;
    url?: string;
    filename?: string;
    mimeType?: string;
    size?: number;
    metadata?: Record<string, unknown>;
  }>;
}

// ===== Utility Functions =====

/**
 * Extract plain text output from gRPC components (first TextComponent content).
 * Used for backward-compatible `output` field in DB.
 */
export function extractTextFromComponents(grpcComponents: any[]): string {
  for (const comp of grpcComponents) {
    const { type, data } = extractComponentData(comp);
    if (type === 'text' && data.content) return data.content as string;
  }
  return '';
}

/**
 * Truncate a single component's data if its JSON exceeds maxBytes.
 */
export function truncateComponentData(
  data: Record<string, unknown>,
  maxBytes: number,
): Record<string, unknown> {
  const json = JSON.stringify(data);
  if (json.length <= maxBytes) return data;
  if (typeof data.content === 'string') {
    return { ...data, content: '[truncated]' };
  }
  return data;
}

/**
 * Convert gRPC components to our stored format, assigning stable IDs.
 * Caps at maxComponents and truncates oversized data.
 */
export function mapGrpcComponents(
  grpcComponents: any[],
  taskId: string,
  maxComponents = MAX_COMPONENTS_PER_TASK_DEFAULT,
  maxDataBytes = MAX_COMPONENT_DATA_BYTES_DEFAULT,
): Array<{ id: string; type: string; data: Record<string, unknown> }> {
  const comps = (grpcComponents || []).slice(-maxComponents);
  return comps.map((comp: any, idx: number) => {
    const { type, data } = extractComponentData(comp);
    return { id: comp.id || `comp-${taskId}-${idx}`, type, data: truncateComponentData(data, maxDataBytes) };
  });
}

/**
 * Simple concurrency limiter — runs at most `concurrency` promises at a time.
 */
export function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        fn().then(resolve, reject).finally(() => {
          active--;
          if (queue.length > 0) queue.shift()!();
        });
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
}

/**
 * Merge new components with existing humanFeedback components.
 * Preserves answered HF components by prepending them before new components.
 */
export function mergeWithExistingHumanFeedback(
  existingComponents: any[],
  newComponents: any[],
): any[] {
  const hf = (existingComponents || []).filter((c: any) => c.type === 'humanFeedback');
  if (hf.length > 0) {
    return [...hf, ...newComponents];
  }
  return newComponents;
}

/**
 * Kahn's algorithm returning tasks grouped by level for parallel execution.
 * Each inner array contains tasks with no dependencies on each other.
 */
export function topologicalSortByLevel(tasks: any[], edges: any[]): any[][] {
  const taskMap = new Map<string, any>();
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const task of tasks) {
    taskMap.set(task.id, task);
    inDegree.set(task.id, 0);
    adjacency.set(task.id, []);
  }

  for (const edge of edges) {
    const source = edge.sourceId || edge.source_id;
    const target = edge.targetId || edge.target_id;
    if (adjacency.has(source) && inDegree.has(target)) {
      adjacency.get(source)!.push(target);
      inDegree.set(target, (inDegree.get(target) || 0) + 1);
    }
  }

  let queue: string[] = [];
  for (const [taskId, degree] of inDegree) {
    if (degree === 0) queue.push(taskId);
  }

  const levels: any[][] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    // Sort by executionOrder for stable ordering among same-level tasks
    queue.sort((a, b) => {
      const taskA = taskMap.get(a);
      const taskB = taskMap.get(b);
      return (taskA?.executionOrder || 0) - (taskB?.executionOrder || 0);
    });

    const level: any[] = queue.map((id) => taskMap.get(id)!);
    levels.push(level);

    const nextQueue: string[] = [];
    for (const id of queue) {
      visited.add(id);
      for (const neighbor of adjacency.get(id) || []) {
        const newDegree = (inDegree.get(neighbor) || 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) nextQueue.push(neighbor);
      }
    }
    queue = nextQueue;
  }

  // If some tasks weren't reachable (cycle), add them as a final level
  const unreached = tasks.filter((t) => !visited.has(t.id));
  if (unreached.length > 0) {
    levels.push(unreached);
  }

  return levels;
}

export interface TaskArtifactEntry {
  portId: string;
  artifactKind: string;
  content?: string;
  url?: string;
  filename?: string;
  mimeType?: string;
  size?: number;
  metadata?: Record<string, unknown>;
}

export function extractArtifactsFromResult(
  task: any,
  grpcComponents: any[],
): TaskArtifactEntry[] {
  const artifacts: TaskArtifactEntry[] = [];
  if (!task) return artifacts;
  const outputPorts = task.outputPorts || [];

  for (const comp of grpcComponents) {
    const { type, data } = extractComponentData(comp);

    if (type === 'artifact') {
      const port = outputPorts.find((p: any) => p.artifactKind === 'document') || { id: 'default' };
      artifacts.push({
        portId: (port as any).id || 'default',
        artifactKind: 'document',
        url: (data as any)?.file_path,
        filename: (data as any)?.filename,
        mimeType: (data as any)?.mime_type,
      });
    } else if (type === 'text') {
      const port = outputPorts.find((p: any) => p.artifactKind === 'text');
      if (port) {
        artifacts.push({
          portId: (port as any).id || 'default',
          artifactKind: 'text',
          content: (data as any)?.content,
        });
      }
    } else if (type === 'code') {
      const port = outputPorts.find((p: any) => p.artifactKind === 'code');
      if (port) {
        artifacts.push({
          portId: (port as any).id || 'default',
          artifactKind: 'code',
          content: (data as any)?.code,
        });
      }
    }
  }

  const textOutput = extractTextFromComponents(grpcComponents);
  if (textOutput && !artifacts.some((a) => a.artifactKind === 'text')) {
    artifacts.push({
      portId: outputPorts[0]?.id || 'default',
      artifactKind: 'text',
      content: textOutput,
    });
  }

  return artifacts;
}
