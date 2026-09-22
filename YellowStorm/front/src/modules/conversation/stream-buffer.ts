import type { StreamingComponent } from './types';

export type BufferedStreamChunk = {
  action: 'add' | 'update' | 'delete';
  component: StreamingComponent;
  revision?: number;
};

type StreamingBufferMetrics = {
  recordEnqueue(): void;
  recordFlush(chunkCount: number, durationMs: number): void;
};

const MAX_QUEUED_CHUNKS = 500;
const HIDDEN_TAB_FLUSH_INTERVAL_MS = 250;

export class StreamingBuffer {
  private queue: BufferedStreamChunk[] = [];
  private scheduled = false;
  private rafId: number | null = null;
  private hiddenTimer: ReturnType<typeof setTimeout> | null = null;
  private flushCallback: ((chunks: BufferedStreamChunk[]) => void) | null = null;
  private overflowCallback: (() => void) | null = null;

  constructor(private readonly metrics?: StreamingBufferMetrics) {}

  setFlushCallback(callback: (chunks: BufferedStreamChunk[]) => void) {
    this.flushCallback = callback;
  }

  setOverflowCallback(callback: () => void) {
    this.overflowCallback = callback;
  }

  addChunk(action: BufferedStreamChunk['action'], component: StreamingComponent, revision?: number) {
    this.metrics?.recordEnqueue();
    this.queue.push({ action, component, revision });
    if (this.queue.length > MAX_QUEUED_CHUNKS) {
      this.queue = [];
      this.cancelScheduledFlush();
      this.overflowCallback?.();
      return;
    }
    this.scheduleFlush();
  }

  flush() {
    this.cancelScheduledFlush();
    this.flushQueued();
  }

  clear() {
    this.queue = [];
    this.cancelScheduledFlush();
  }

  discardThrough(revision: number) {
    this.queue = this.queue.filter((chunk) => chunk.revision === undefined || chunk.revision > revision);
  }

  private scheduleFlush() {
    if (this.scheduled || this.queue.length === 0) return;
    this.scheduled = true;
    if (typeof document !== 'undefined' && document.hidden) {
      this.hiddenTimer = setTimeout(() => {
        this.hiddenTimer = null;
        this.scheduled = false;
        this.flushQueued();
      }, HIDDEN_TAB_FLUSH_INTERVAL_MS);
    } else if (typeof requestAnimationFrame === 'function') {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.scheduled = false;
        this.flushQueued();
      });
    } else {
      this.hiddenTimer = setTimeout(() => {
        this.hiddenTimer = null;
        this.scheduled = false;
        this.flushQueued();
      }, 0);
    }
  }

  private flushQueued() {
    if (this.queue.length === 0 || !this.flushCallback) return;
    const chunks = this.queue.splice(0);
    const startedAt = performance.now();
    this.flushCallback(chunks);
    this.metrics?.recordFlush(chunks.length, performance.now() - startedAt);
  }

  private cancelScheduledFlush() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.hiddenTimer) {
      clearTimeout(this.hiddenTimer);
      this.hiddenTimer = null;
    }
    this.scheduled = false;
  }
}

export function applyChunksToComponents(components: StreamingComponent[], chunks: BufferedStreamChunk[]): StreamingComponent[] {
  let result = [...components];
  for (const { action, component } of chunks) {
    if (action === 'add') {
      const existingIndex = result.findIndex((item) => item.id === component.id);
      if (component.type === 'toolActivity' && existingIndex >= 0) {
        const existing = result[existingIndex];
        result[existingIndex] = { ...existing, data: mergeStreamingData('toolActivity', existing.data, component.data) };
      } else {
        result.push({ ...component, data: initializeStreamingData(component.type, component.data) });
      }
    } else if (action === 'update') {
      const hasExisting = result.some((item) => item.id === component.id);
      result = result.map((item) => item.id === component.id
        ? { ...item, data: mergeStreamingData(item.type, item.data, component.data) }
        : item);
      if (!hasExisting && component.type === 'toolActivity') {
        result.push({ ...component, data: initializeStreamingData(component.type, component.data) });
      }
    } else {
      result = result.filter((item) => item.id !== component.id);
    }
  }
  return result;
}

function parseJsonArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function initializeStreamingData(type: string, data: Record<string, unknown>): Record<string, unknown> {
  if (type !== 'chart') return { ...data };
  let actualData: Record<string, unknown>[] = [];
  if (Array.isArray(data.data)) actualData = data.data;
  else if (typeof data.data === 'object' && data.data !== null && 'data' in data.data && Array.isArray(data.data.data)) actualData = data.data.data;
  else if (Array.isArray(data.chartData)) actualData = data.chartData;
  else actualData = parseJsonArray(data.data) || parseJsonArray(data.chartData);
  return { ...data, chartData: actualData, data: actualData };
}

function mergeStreamingData(type: string, existing: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  switch (type) {
    case 'text': {
      if (incoming.guardrailDecision) return { ...existing, ...incoming };
      const existingContent = (existing.content as string) || '';
      const newContent = (incoming.content as string) || '';
      const sentenceGap = /[.!?][\])"']?$/.test(existingContent) && /^\p{Lu}/u.test(newContent) ? ' ' : '';
      return { ...existing, content: existingContent + sentenceGap + newContent };
    }
    case 'agentActivity':
      return { ...existing, ...incoming };
    case 'code':
      return {
        ...existing,
        content: ((existing.content as string) || '') + ((incoming.content as string) || ''),
        language: (incoming.language as string) || existing.language,
        filename: (incoming.filename as string) || existing.filename,
      };
    case 'queue':
    case 'plan':
    case 'checkpoint':
    case 'task':
    case 'error':
    case 'citation':
      return { ...incoming };
    case 'toolActivity': {
      const existingStatus = (existing.status as string) || 'running';
      const incomingStatus = (incoming.status as string) || existingStatus;
      const existingIsTerminal = ['completed', 'failed', 'stopped'].includes(existingStatus);
      return {
        ...existing,
        ...incoming,
        toolName: (incoming.toolName as string) || (existing.toolName as string) || '',
        status: existingIsTerminal ? existingStatus : incomingStatus,
        paramsJson: (incoming.paramsJson as string) || (existing.paramsJson as string) || '',
        startedAt: (incoming.startedAt as string) || (existing.startedAt as string) || '',
        ...(incoming.summary || existing.summary ? { summary: (incoming.summary as string) || (existing.summary as string) } : {}),
        ...(incoming.renderKind || existing.renderKind
          ? { renderKind: existing.renderKind && existing.renderKind !== 'generic' ? existing.renderKind : incoming.renderKind || existing.renderKind || 'generic' }
          : {}),
      };
    }
    case 'chart': {
      const incomingChartData = parseJsonArray(incoming.chartData);
      const existingChartData = parseJsonArray(existing.chartData);
      const finalChartData = incomingChartData.length ? incomingChartData : existingChartData;
      const chartDataObject = typeof incoming.data === 'object' && incoming.data !== null
        ? { ...(typeof existing.data === 'object' && existing.data !== null ? existing.data : {}), ...incoming.data }
        : typeof existing.data === 'object' && existing.data !== null ? existing.data : {};
      return {
        ...existing,
        ...incoming,
        data: chartDataObject,
        chartData: finalChartData,
        kind: (incoming.kind as string) || (existing.kind as string) || 'bar',
        layout: (incoming.layout as string) || (existing.layout as string) || 'horizontal',
      };
    }
    case 'sandbox':
      return {
        code: (incoming.code as string) || (existing.code as string) || '',
        output: (incoming.output as string) || (existing.output as string) || '',
        error: (incoming.error as string) || (existing.error as string) || '',
        outputAvailable: incoming.outputAvailable === true || existing.outputAvailable === true,
      };
    default:
      return { ...existing, ...incoming };
  }
}
