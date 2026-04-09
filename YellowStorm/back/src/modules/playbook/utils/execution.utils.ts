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

const ARTIFACT_KIND_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'document',
  '.doc': 'document',
  '.docx': 'document',
  '.odt': 'document',
  '.rtf': 'document',
  '.txt': 'text',
  '.md': 'text',
  '.py': 'code',
  '.js': 'code',
  '.ts': 'code',
  '.tsx': 'code',
  '.jsx': 'code',
  '.java': 'code',
  '.kt': 'code',
  '.go': 'code',
  '.rs': 'code',
  '.c': 'code',
  '.cpp': 'code',
  '.h': 'code',
  '.cs': 'code',
  '.rb': 'code',
  '.php': 'code',
  '.sh': 'code',
  '.bat': 'code',
  '.sql': 'code',
  '.r': 'code',
  '.lua': 'code',
  '.swift': 'code',
  '.csv': 'data',
  '.xlsx': 'data',
  '.xls': 'data',
  '.json': 'data',
  '.xml': 'data',
  '.yaml': 'data',
  '.yml': 'data',
  '.tsv': 'data',
  '.png': 'image',
  '.jpg': 'image',
  '.jpeg': 'image',
  '.gif': 'image',
  '.bmp': 'image',
  '.svg': 'image',
  '.webp': 'image',
  '.pptx': 'document',
  '.ppt': 'document',
  '.odp': 'document',
};

const ARTIFACT_KIND_BY_MIME: Record<string, string> = {
  'application/pdf': 'document',
  'application/msword': 'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'document',
  'text/plain': 'text',
  'text/markdown': 'text',
  'text/csv': 'data',
  'application/json': 'data',
  'application/xml': 'data',
  'text/xml': 'data',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'data',
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/gif': 'image',
  'image/svg+xml': 'image',
  'image/webp': 'image',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'document',
};

function normalizePortId(value: unknown): string {
  const raw = String(value || 'default').trim() || 'default';
  if (raw.startsWith('in-') || raw.startsWith('out-')) {
    return raw.split('-', 2)[1] || 'default';
  }
  return raw;
}

function inferArtifactKind(filename?: string, mimeType?: string): string | undefined {
  if (filename) {
    const lower = filename.toLowerCase();
    const dotIndex = lower.lastIndexOf('.');
    if (dotIndex !== -1) {
      const inferred = ARTIFACT_KIND_BY_EXTENSION[lower.slice(dotIndex)];
      if (inferred) return inferred;
    }
  }
  if (mimeType) return ARTIFACT_KIND_BY_MIME[mimeType];
  return undefined;
}

function normalizePortText(value: any): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const FILENAME_PORT_HINTS: Record<string, string[]> = {
  '.docx': ['docx', 'doc'],
  '.pptx': ['pptx', 'ppt'],
  '.xlsx': ['xlsx', 'xls', 'excel'],
  '.doc': ['doc'],
  '.ppt': ['ppt'],
  '.xls': ['xls', 'excel'],
  '.pdf': ['pdf'],
  '.md': ['md', 'markdown'],
  '.txt': ['txt', 'text'],
};

function inferFilenameTokens(filename: string | undefined): string[] {
  const normalizedFilename = String(filename || '').trim().toLowerCase();
  if (!normalizedFilename) return [];

  const tokens = new Set<string>();
  const stem = normalizedFilename.replace(/\.[^.]+$/, '');
  if (stem) tokens.add(normalizePortText(stem));
  if (stem.startsWith('out-') || stem.startsWith('in-')) {
    tokens.add(normalizePortText(stem.split('-', 2)[1] || ''));
  }

  const extension = normalizedFilename.includes('.')
    ? normalizedFilename.slice(normalizedFilename.lastIndexOf('.'))
    : '';
  if (extension) {
    tokens.add(normalizePortText(extension.slice(1)));
    for (const hint of FILENAME_PORT_HINTS[extension] || []) {
      tokens.add(normalizePortText(hint));
    }
  }

  return [...tokens].filter(Boolean);
}

function portMatchesFilenameToken(port: any, token: string): boolean {
  const normalizedToken = normalizePortText(token);
  if (!normalizedToken) return false;

  const portId = normalizePortText(port?.id);
  const portName = normalizePortText(port?.name);
  return [portId, portName].some((value) => value && (value === normalizedToken || value.includes(normalizedToken)));
}

function inferOutputPortIdFromFilename(filename: string | undefined, outputPorts: any[]): string {
  const candidateTokens = inferFilenameTokens(filename);
  if (!candidateTokens.length) return '';

  for (const candidate of candidateTokens) {
    for (const port of outputPorts || []) {
      const portId = normalizePortId(port?.id);
      if (portId && portMatchesFilenameToken(port, candidate)) {
        return portId;
      }
    }
  }

  return '';
}

function resolveOutputPort(
  task: any,
  outputPorts: any[],
  options: { preferredKind?: string; explicitPortId?: string; filename?: string; skipIfNoCompatible?: boolean; componentLabel: string },
): any | null {
  if (!outputPorts?.length) return null;

  const taskId = task?.id || 'unknown';
  const preferredKind = String(options.preferredKind || '').trim();
  const explicitPortId = String(options.explicitPortId || '').trim();

  if (explicitPortId) {
    const normalizedId = normalizePortId(explicitPortId);
    const explicitPort = outputPorts.find((port: any) => normalizePortId(port?.id) === normalizedId);
    if (!explicitPort) {
      throw new Error(`Task '${taskId}' produced ${options.componentLabel} targeting unknown output port '${normalizedId}'`);
    }
    if (preferredKind && explicitPort.artifactKind !== preferredKind) {
      throw new Error(
        `Task '${taskId}' produced ${options.componentLabel} for output port '${normalizedId}' with incompatible kind '${preferredKind}'`,
      );
    }
    return explicitPort;
  }

  const candidates = preferredKind
    ? outputPorts.filter((port: any) => port?.artifactKind === preferredKind)
    : outputPorts;

  if (candidates.length === 1) return candidates[0];
  if (options.filename) {
    const inferredPortId = inferOutputPortIdFromFilename(options.filename, candidates);
    if (inferredPortId) {
      const inferredPort = candidates.find((port: any) => normalizePortId(port?.id) === inferredPortId);
      if (inferredPort) return inferredPort;
    }
  }
  if (candidates.length === 0 && options.skipIfNoCompatible) return null;

  if (candidates.length === 0) {
    throw new Error(`Task '${taskId}' produced ${options.componentLabel} with no compatible output port for kind '${preferredKind || 'unknown'}'`);
  }

  const defaultPort = candidates.find((port: any) => normalizePortId(port?.id) === 'default');
  if (defaultPort) {
    return defaultPort;
  }

  return candidates[0];
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
      const filename = (data as any)?.filename || '';
      const mimeType = (data as any)?.mime_type || (data as any)?.mimeType || '';
      const preferredKind = (data as any)?.artifact_kind
        || (data as any)?.artifactKind
        || inferArtifactKind(filename, mimeType)
        || 'document';
      const port = resolveOutputPort(task, outputPorts, {
        preferredKind,
        explicitPortId: (data as any)?.output_port_id || (data as any)?.outputPortId,
        filename,
        skipIfNoCompatible: true,
        componentLabel: `artifact '${filename || (data as any)?.file_path || (data as any)?.filePath || 'unnamed'}'`,
      });
      if (!port) continue;
      const artifactKind = (port as any).artifactKind || preferredKind || 'document';
      artifacts.push({
        portId: (port as any).id || 'default',
        artifactKind,
        url: (data as any)?.file_path || (data as any)?.filePath,
        filename,
        mimeType,
      });
    } else if (type === 'text') {
      const explicitPortId = (data as any)?.output_port_id || (data as any)?.outputPortId;
      if (!explicitPortId) {
        const textPorts = outputPorts.filter((p: any) => p.artifactKind === 'text');
        if (textPorts.length > 1) {
          continue;
        }
      }
      const port = resolveOutputPort(task, outputPorts, {
        preferredKind: 'text',
        explicitPortId,
        skipIfNoCompatible: true,
        componentLabel: 'text component',
      });
      if (port) {
        artifacts.push({
          portId: (port as any).id || 'default',
          artifactKind: 'text',
          content: (data as any)?.content,
        });
      }
    } else if (type === 'code') {
      const port = resolveOutputPort(task, outputPorts, {
        preferredKind: 'code',
        explicitPortId: (data as any)?.output_port_id || (data as any)?.outputPortId,
        componentLabel: 'code component',
      }) || { id: 'default' };
      artifacts.push({
        portId: (port as any).id || 'default',
        artifactKind: 'code',
        content: (data as any)?.code || (data as any)?.content,
      });
    }
  }

  const textOutput = extractTextFromComponents(grpcComponents);
  const textPorts = outputPorts.filter((p: any) => p.artifactKind === 'text');
  const textPort = textPorts.length === 1 ? textPorts[0] : null;
  if (textOutput && !artifacts.some((a) => a.artifactKind === 'text') && (textPort || outputPorts.length === 0)) {
    artifacts.push({
      portId: (textPort as any)?.id || 'default',
      artifactKind: 'text',
      content: textOutput,
    });
  }

  return artifacts;
}

export function mapGrpcTaskArtifacts(grpcArtifacts: any[] | undefined | null): TaskArtifactEntry[] {
  return (grpcArtifacts || [])
    .filter((artifact: any) => artifact && typeof artifact === 'object')
    .map((artifact: any) => ({
      portId: artifact.port_id || artifact.portId || 'default',
      artifactKind: artifact.artifact_kind || artifact.artifactKind || 'text',
      content: artifact.content || undefined,
      url: artifact.url || undefined,
      filename: artifact.filename || undefined,
      mimeType: artifact.mime_type || artifact.mimeType || undefined,
      size: typeof artifact.size === 'string' ? Number(artifact.size) : artifact.size,
    }));
}
