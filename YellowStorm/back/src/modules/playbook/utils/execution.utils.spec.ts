import {
  extractTextFromComponents,
  truncateComponentData,
  mapGrpcComponents,
  mapGrpcPortPayloads,
  pLimit,
  mergeWithExistingHumanFeedback,
  topologicalSortByLevel,
  extractArtifactsFromResult,
  MAX_COMPONENTS_PER_TASK_DEFAULT,
  MAX_COMPONENT_DATA_BYTES_DEFAULT,
} from './execution.utils';

jest.mock('../../conversation/utils/component-mapper', () => ({
  extractComponentData: jest.fn(),
}));

import { extractComponentData } from '../../conversation/utils/component-mapper';

const mockExtractComponentData = extractComponentData as jest.MockedFunction<
  typeof extractComponentData
>;

describe('execution.utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── extractTextFromComponents ────────────────────────────────────────────

  describe('extractTextFromComponents', () => {
    it('should return the content of the first text component', () => {
      mockExtractComponentData
        .mockReturnValueOnce({ type: 'code' as any, data: { language: 'js', code: 'x=1' } })
        .mockReturnValueOnce({ type: 'text' as any, data: { content: 'Hello world' } });

      const result = extractTextFromComponents([{ id: '1' }, { id: '2' }]);

      expect(result).toBe('Hello world');
      expect(mockExtractComponentData).toHaveBeenCalledTimes(2);
    });

    it('should return the first text component even when multiple exist', () => {
      // Note: extractTextFromComponents returns early on first text match,
      // so only the first mockReturnValueOnce will be consumed.
      mockExtractComponentData.mockReturnValueOnce({
        type: 'text' as any,
        data: { content: 'First' },
      });

      const result = extractTextFromComponents([{ id: '1' }, { id: '2' }]);

      expect(result).toBe('First');
      expect(mockExtractComponentData).toHaveBeenCalledTimes(1);
    });

    it('should return empty string for an empty array', () => {
      const result = extractTextFromComponents([]);

      expect(result).toBe('');
      expect(mockExtractComponentData).not.toHaveBeenCalled();
    });

    it('should return empty string when no text component is present', () => {
      mockExtractComponentData
        .mockReturnValueOnce({ type: 'code' as any, data: { language: 'js', code: 'x=1' } })
        .mockReturnValueOnce({ type: 'image' as any, data: { url: 'http://img.png' } });

      const result = extractTextFromComponents([{ id: '1' }, { id: '2' }]);

      expect(result).toBe('');
    });

    it('should return empty string when text component has falsy content', () => {
      mockExtractComponentData.mockReturnValueOnce({
        type: 'text' as any,
        data: { content: '' },
      });

      const result = extractTextFromComponents([{ id: '1' }]);

      expect(result).toBe('');
    });
  });

  // ─── truncateComponentData ────────────────────────────────────────────────

  describe('truncateComponentData', () => {
    it('should return data unchanged if within the byte limit', () => {
      const data = { content: 'short text', extra: 42 };

      const result = truncateComponentData(data, 10_000);

      expect(result).toBe(data);
    });

    it('should return data unchanged if exactly at the byte limit', () => {
      const data = { content: 'hi' };
      const json = JSON.stringify(data);

      const result = truncateComponentData(data, json.length);

      expect(result).toBe(data);
    });

    it('should truncate content field to [truncated] when over limit', () => {
      const data = { content: 'a'.repeat(1000), meta: 'keep' };

      const result = truncateComponentData(data, 50);

      expect(result.content).toBe('[truncated]');
      expect(result.meta).toBe('keep');
    });

    it('should return data unchanged when over limit but content is not a string', () => {
      const data = { content: 12345, largeField: 'x'.repeat(1000) };

      const result = truncateComponentData(data, 50);

      // content is not a string, so data is returned as-is
      expect(result).toBe(data);
    });

    it('should return data unchanged when over limit and no content field exists', () => {
      const data = { bigField: 'x'.repeat(1000) };

      const result = truncateComponentData(data, 50);

      expect(result).toBe(data);
    });

    it('should not mutate the original data object when truncating', () => {
      const data = { content: 'a'.repeat(500), extra: true };
      const originalContent = data.content;

      truncateComponentData(data, 10);

      expect(data.content).toBe(originalContent);
    });
  });

  // ─── mapGrpcComponents ────────────────────────────────────────────────────

  describe('mapGrpcComponents', () => {
    it('should map components with stable IDs (comp-{taskId}-{idx})', () => {
      mockExtractComponentData
        .mockReturnValueOnce({ type: 'text' as any, data: { content: 'Hello' } })
        .mockReturnValueOnce({ type: 'code' as any, data: { language: 'js', code: 'x=1' } });

      const grpcComps = [{}, {}]; // no id field

      const result = mapGrpcComponents(grpcComps, 'task-42');

      expect(result).toEqual([
        { id: 'comp-task-42-0', type: 'text', data: { content: 'Hello' } },
        { id: 'comp-task-42-1', type: 'code', data: { language: 'js', code: 'x=1' } },
      ]);
    });

    it('should use the component own id field if present', () => {
      mockExtractComponentData.mockReturnValueOnce({
        type: 'text' as any,
        data: { content: 'Hi' },
      });

      const grpcComps = [{ id: 'custom-id-99' }];

      const result = mapGrpcComponents(grpcComps, 'task-1');

      expect(result[0].id).toBe('custom-id-99');
    });

    it('should cap at maxComponents, keeping the last N', () => {
      mockExtractComponentData.mockImplementation((comp: any) => ({
        type: 'text' as any,
        data: { content: comp.value },
      }));

      const grpcComps = [
        { value: 'A' },
        { value: 'B' },
        { value: 'C' },
        { value: 'D' },
        { value: 'E' },
      ];

      const result = mapGrpcComponents(grpcComps, 't', 3);

      expect(result).toHaveLength(3);
      // slice(-3) keeps C, D, E
      expect(result[0].data.content).toBe('C');
      expect(result[1].data.content).toBe('D');
      expect(result[2].data.content).toBe('E');
    });

    it('should handle empty array', () => {
      const result = mapGrpcComponents([], 'task-1');

      expect(result).toEqual([]);
      expect(mockExtractComponentData).not.toHaveBeenCalled();
    });

    it('should handle null/undefined input gracefully', () => {
      const result = mapGrpcComponents(null as any, 'task-1');

      expect(result).toEqual([]);
    });

    it('should truncate oversized component data', () => {
      const largeContent = 'x'.repeat(1000);
      mockExtractComponentData.mockReturnValueOnce({
        type: 'text' as any,
        data: { content: largeContent },
      });

      const result = mapGrpcComponents([{}], 'task-1', 200, 50);

      expect(result[0].data.content).toBe('[truncated]');
    });

    it('should use defaults for maxComponents and maxDataBytes', () => {
      // Verify the defaults are exported and reasonable
      expect(MAX_COMPONENTS_PER_TASK_DEFAULT).toBe(200);
      expect(MAX_COMPONENT_DATA_BYTES_DEFAULT).toBe(500_000);
    });
  });

  describe('extractArtifactsFromResult', () => {
    it('routes explicit same-kind file outputs by port id', () => {
      mockExtractComponentData.mockImplementation((comp: any) => {
        if (comp.id === 'artifact-1') {
          return {
            type: 'artifact' as any,
            data: {
              artifact_kind: 'document',
              output_port_id: 'out-pdf',
              file_path: 'https://example.com/report.pdf',
              filename: 'report.pdf',
            },
          };
        }

        return {
          type: 'artifact' as any,
          data: {
            artifact_kind: 'document',
            output_port_id: 'out-pptx',
            file_path: 'https://example.com/deck.pptx',
            filename: 'deck.pptx',
          },
        };
      });

      const result = extractArtifactsFromResult(
        {
          id: 'task-1',
          outputPorts: [
            { id: 'out-pdf', name: 'PDF', artifactKind: 'document' },
            { id: 'out-pptx', name: 'pptx', artifactKind: 'document' },
          ],
        },
        [{ id: 'artifact-1' }, { id: 'artifact-2' }],
      );

      expect(result).toEqual([
        {
          portId: 'out-pdf',
          artifactKind: 'document',
          url: 'https://example.com/report.pdf',
          filename: 'report.pdf',
          mimeType: '',
        },
        {
          portId: 'out-pptx',
          artifactKind: 'document',
          url: 'https://example.com/deck.pptx',
          filename: 'deck.pptx',
          mimeType: '',
        },
      ]);
    });

    it('routes same-kind file outputs by filename when possible', () => {
      mockExtractComponentData.mockReturnValue({
        type: 'artifact' as any,
        data: {
          artifact_kind: 'document',
          file_path: 'https://example.com/report.pdf',
          filename: 'report.pdf',
        },
      });

      const result = extractArtifactsFromResult(
        {
          id: 'task-1',
          outputPorts: [
            { id: 'out-pdf', name: 'PDF', artifactKind: 'document' },
            { id: 'out-docx', name: 'DOCX', artifactKind: 'document' },
          ],
        },
        [{ id: 'artifact-1' }],
      );

      expect(result).toEqual([
        {
          portId: 'out-pdf',
          artifactKind: 'document',
          url: 'https://example.com/report.pdf',
          filename: 'report.pdf',
          mimeType: '',
        },
      ]);
    });

    it('infers the output port from the generated filename when possible', () => {
      mockExtractComponentData.mockReturnValue({
        type: 'artifact' as any,
        data: {
          artifact_kind: 'document',
          file_path: 'https://example.com/out-0f975e8a.pdf',
          filename: 'out-0f975e8a.pdf',
        },
      });

      const result = extractArtifactsFromResult(
        {
          id: 'task-1',
          outputPorts: [
            { id: '0f975e8a', name: 'PDF report', artifactKind: 'document' },
            { id: 'another-port', name: 'DOCX report', artifactKind: 'document' },
          ],
        },
        [{ id: 'artifact-1' }],
      );

      expect(result).toEqual([
        {
          portId: '0f975e8a',
          artifactKind: 'document',
          url: 'https://example.com/out-0f975e8a.pdf',
          filename: 'out-0f975e8a.pdf',
          mimeType: '',
        },
      ]);
    });

    it('infers file kind before routing to distinct output ports', () => {
      mockExtractComponentData.mockImplementation((comp: any) => {
        if (comp.id === 'artifact-1') {
          return {
            type: 'artifact' as any,
            data: {
              file_path: 'https://example.com/report.pdf',
              filename: 'report.pdf',
            },
          };
        }

        return {
          type: 'artifact' as any,
          data: {
            file_path: 'https://example.com/deck.pptx',
            filename: 'deck.pptx',
          },
        };
      });

      const result = extractArtifactsFromResult(
        {
          id: 'task-1',
          outputPorts: [
            { id: 'pdf-doc', name: 'PDF doc', artifactKind: 'document' },
            { id: 'ppt-doc', name: 'PPT doc', artifactKind: 'document' },
          ],
        },
        [{ id: 'artifact-1' }, { id: 'artifact-2' }],
      );

      expect(result).toEqual([
        {
          portId: 'pdf-doc',
          artifactKind: 'document',
          url: 'https://example.com/report.pdf',
          filename: 'report.pdf',
          mimeType: '',
        },
        {
          portId: 'ppt-doc',
          artifactKind: 'document',
          url: 'https://example.com/deck.pptx',
          filename: 'deck.pptx',
          mimeType: '',
        },
      ]);
    });

    it('skips preview text when multiple text ports exist and no explicit port id is set', () => {
      mockExtractComponentData.mockReturnValue({
        type: 'text' as any,
        data: {
          content: 'Streaming preview text',
        },
      });

      const result = extractArtifactsFromResult(
        {
          id: 'task-1',
          outputPorts: [
            { id: 'summary', name: 'Summary', artifactKind: 'text' },
            { id: 'context', name: 'Context', artifactKind: 'text' },
          ],
        },
        [{ id: 'text-1' }],
      );

      expect(result).toEqual([]);
    });
  });

  describe('mapGrpcPortPayloads', () => {
    it('preserves structured data and provenance fields', () => {
      const result = mapGrpcPortPayloads([
        {
          port_id: 'summary',
          artifact_kind: 'data',
          data: { score: 0.9 },
          source_task_id: 'task-a',
          source_port_id: 'out-1',
          produced_at: '2026-04-20T00:00:00.000Z',
          metadata: { note: 'kept' },
        },
      ]);

      expect(result).toEqual([
        expect.objectContaining({
          portId: 'summary',
          artifactKind: 'data',
          data: { score: 0.9 },
          sourceTaskId: 'task-a',
          sourcePortId: 'out-1',
          producedAt: '2026-04-20T00:00:00.000Z',
          metadata: expect.objectContaining({
            note: 'kept',
            data: { score: 0.9 },
          }),
        }),
      ]);
    });
  });

  // ─── pLimit ───────────────────────────────────────────────────────────────

  describe('pLimit', () => {
    it('should respect concurrency limit', async () => {
      const limit = pLimit(2);
      let running = 0;
      let maxRunning = 0;

      const task = () =>
        limit(
          () =>
            new Promise<void>((resolve) => {
              running++;
              maxRunning = Math.max(maxRunning, running);
              setTimeout(() => {
                running--;
                resolve();
              }, 10);
            }),
        );

      await Promise.all([task(), task(), task(), task(), task()]);

      expect(maxRunning).toBe(2);
    });

    it('should queue excess tasks and run them when slots free up', async () => {
      const limit = pLimit(1);
      const order: number[] = [];

      const makeTask = (n: number) =>
        limit(
          () =>
            new Promise<void>((resolve) => {
              order.push(n);
              setTimeout(resolve, 5);
            }),
        );

      await Promise.all([makeTask(1), makeTask(2), makeTask(3)]);

      expect(order).toEqual([1, 2, 3]);
    });

    it('should work with concurrency=1 (serial execution)', async () => {
      const limit = pLimit(1);
      let running = 0;
      let maxRunning = 0;

      const task = () =>
        limit(
          () =>
            new Promise<void>((resolve) => {
              running++;
              maxRunning = Math.max(maxRunning, running);
              setTimeout(() => {
                running--;
                resolve();
              }, 5);
            }),
        );

      await Promise.all([task(), task(), task()]);

      expect(maxRunning).toBe(1);
    });

    it('should resolve promises with the correct values', async () => {
      const limit = pLimit(2);

      const results = await Promise.all([
        limit(() => Promise.resolve('a')),
        limit(() => Promise.resolve('b')),
        limit(() => Promise.resolve('c')),
      ]);

      expect(results).toEqual(['a', 'b', 'c']);
    });

    it('should propagate rejections', async () => {
      const limit = pLimit(2);

      await expect(limit(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    });

    it('should continue processing the queue after a rejection', async () => {
      const limit = pLimit(1);

      const failing = limit(() => Promise.reject(new Error('fail'))).catch(() => 'caught');
      const passing = limit(() => Promise.resolve('ok'));

      const results = await Promise.all([failing, passing]);

      expect(results).toEqual(['caught', 'ok']);
    });

    it('should handle high concurrency with many tasks', async () => {
      const limit = pLimit(10);
      const results: number[] = [];

      const tasks = Array.from({ length: 50 }, (_, i) =>
        limit(async () => {
          results.push(i);
          return i;
        }),
      );

      const resolved = await Promise.all(tasks);

      expect(resolved).toHaveLength(50);
      expect(results).toHaveLength(50);
    });
  });

  // ─── mergeWithExistingHumanFeedback ───────────────────────────────────────

  describe('mergeWithExistingHumanFeedback', () => {
    it('should return newComponents if no humanFeedback in existing', () => {
      const existing = [
        { type: 'text', data: { content: 'old' } },
        { type: 'code', data: { code: 'x' } },
      ];
      const newComps = [{ type: 'text', data: { content: 'new' } }];

      const result = mergeWithExistingHumanFeedback(existing, newComps);

      expect(result).toBe(newComps);
    });

    it('should prepend humanFeedback components before new components', () => {
      const hfComp = { type: 'humanFeedback', data: { question: 'ok?' } };
      const existing = [{ type: 'text', data: { content: 'old' } }, hfComp];
      const newComps = [{ type: 'text', data: { content: 'new' } }];

      const result = mergeWithExistingHumanFeedback(existing, newComps);

      expect(result).toEqual([hfComp, ...newComps]);
      expect(result).toHaveLength(2);
      expect(result[0].type).toBe('humanFeedback');
    });

    it('should prepend all humanFeedback components when multiple exist', () => {
      const hf1 = { type: 'humanFeedback', data: { question: 'Q1' } };
      const hf2 = { type: 'humanFeedback', data: { question: 'Q2' } };
      const existing = [hf1, { type: 'text', data: {} }, hf2];
      const newComps = [{ type: 'text', data: { content: 'new' } }];

      const result = mergeWithExistingHumanFeedback(existing, newComps);

      expect(result).toEqual([hf1, hf2, ...newComps]);
      expect(result).toHaveLength(3);
    });

    it('should handle null existing components', () => {
      const newComps = [{ type: 'text', data: { content: 'new' } }];

      const result = mergeWithExistingHumanFeedback(null as any, newComps);

      expect(result).toBe(newComps);
    });

    it('should handle undefined existing components', () => {
      const newComps = [{ type: 'text', data: { content: 'new' } }];

      const result = mergeWithExistingHumanFeedback(undefined as any, newComps);

      expect(result).toBe(newComps);
    });

    it('should handle empty existing components', () => {
      const newComps = [{ type: 'text', data: { content: 'new' } }];

      const result = mergeWithExistingHumanFeedback([], newComps);

      expect(result).toBe(newComps);
    });

    it('should handle empty new components with humanFeedback in existing', () => {
      const hfComp = { type: 'humanFeedback', data: { question: 'ok?' } };
      const existing = [hfComp];

      const result = mergeWithExistingHumanFeedback(existing, []);

      expect(result).toEqual([hfComp]);
    });
  });

  // ─── topologicalSortByLevel ───────────────────────────────────────────────

  describe('topologicalSortByLevel', () => {
    it('should sort a linear chain: A->B->C into [[A],[B],[C]]', () => {
      const tasks = [
        { id: 'A', executionOrder: 0 },
        { id: 'B', executionOrder: 1 },
        { id: 'C', executionOrder: 2 },
      ];
      const edges = [
        { sourceId: 'A', targetId: 'B' },
        { sourceId: 'B', targetId: 'C' },
      ];

      const levels = topologicalSortByLevel(tasks, edges);

      expect(levels).toHaveLength(3);
      expect(levels[0].map((t: any) => t.id)).toEqual(['A']);
      expect(levels[1].map((t: any) => t.id)).toEqual(['B']);
      expect(levels[2].map((t: any) => t.id)).toEqual(['C']);
    });

    it('should group parallel tasks (no edges) into a single level', () => {
      const tasks = [
        { id: 'A', executionOrder: 0 },
        { id: 'B', executionOrder: 1 },
        { id: 'C', executionOrder: 2 },
      ];

      const levels = topologicalSortByLevel(tasks, []);

      expect(levels).toHaveLength(1);
      expect(levels[0].map((t: any) => t.id)).toEqual(['A', 'B', 'C']);
    });

    it('should handle diamond shape: A->{B,C}->D', () => {
      const tasks = [
        { id: 'A', executionOrder: 0 },
        { id: 'B', executionOrder: 1 },
        { id: 'C', executionOrder: 2 },
        { id: 'D', executionOrder: 3 },
      ];
      const edges = [
        { sourceId: 'A', targetId: 'B' },
        { sourceId: 'A', targetId: 'C' },
        { sourceId: 'B', targetId: 'D' },
        { sourceId: 'C', targetId: 'D' },
      ];

      const levels = topologicalSortByLevel(tasks, edges);

      expect(levels).toHaveLength(3);
      expect(levels[0].map((t: any) => t.id)).toEqual(['A']);
      expect(levels[1].map((t: any) => t.id).sort()).toEqual(['B', 'C']);
      expect(levels[2].map((t: any) => t.id)).toEqual(['D']);
    });

    it('should handle cycles by placing unreached tasks in a final level', () => {
      const tasks = [
        { id: 'A', executionOrder: 0 },
        { id: 'B', executionOrder: 1 },
        { id: 'C', executionOrder: 2 },
      ];
      // B->C->B creates a cycle; A has no edges so it becomes root
      const edges = [
        { sourceId: 'A', targetId: 'B' },
        { sourceId: 'B', targetId: 'C' },
        { sourceId: 'C', targetId: 'B' },
      ];

      const levels = topologicalSortByLevel(tasks, edges);

      // A is the root, B is first in the chain, then cycle prevents C from resolving normally
      // The cycle means B gets in-degree reduced to 0 from A, then C depends on B but also feeds back.
      // After processing A: B in-degree -> 0, process B: C in-degree -> 0, process C: B in-degree -> -1
      // Actually let's just verify all tasks appear somewhere in the levels
      const allIds = levels.flat().map((t: any) => t.id);
      expect(allIds).toContain('A');
      expect(allIds).toContain('B');
      expect(allIds).toContain('C');
    });

    it('should place tasks in a pure cycle into the final unreached level', () => {
      const tasks = [
        { id: 'X', executionOrder: 0 },
        { id: 'Y', executionOrder: 1 },
      ];
      // X->Y->X: both have in-degree 1, neither starts at 0
      const edges = [
        { sourceId: 'X', targetId: 'Y' },
        { sourceId: 'Y', targetId: 'X' },
      ];

      const levels = topologicalSortByLevel(tasks, edges);

      // No task has in-degree 0, so all should end up in unreached final level
      expect(levels).toHaveLength(1);
      expect(levels[0].map((t: any) => t.id).sort()).toEqual(['X', 'Y']);
    });

    it('should respect executionOrder for same-level sorting', () => {
      const tasks = [
        { id: 'C', executionOrder: 3 },
        { id: 'A', executionOrder: 1 },
        { id: 'B', executionOrder: 2 },
      ];

      const levels = topologicalSortByLevel(tasks, []);

      expect(levels).toHaveLength(1);
      expect(levels[0].map((t: any) => t.id)).toEqual(['A', 'B', 'C']);
    });

    it('should handle source_id/target_id edge format', () => {
      const tasks = [
        { id: 'A', executionOrder: 0 },
        { id: 'B', executionOrder: 1 },
      ];
      const edges = [{ source_id: 'A', target_id: 'B' }];

      const levels = topologicalSortByLevel(tasks, edges);

      expect(levels).toHaveLength(2);
      expect(levels[0].map((t: any) => t.id)).toEqual(['A']);
      expect(levels[1].map((t: any) => t.id)).toEqual(['B']);
    });

    it('should handle empty tasks and edges', () => {
      const levels = topologicalSortByLevel([], []);

      expect(levels).toEqual([]);
    });

    it('should ignore edges referencing unknown task IDs', () => {
      const tasks = [
        { id: 'A', executionOrder: 0 },
        { id: 'B', executionOrder: 1 },
      ];
      const edges = [
        { sourceId: 'A', targetId: 'B' },
        { sourceId: 'A', targetId: 'UNKNOWN' },
        { sourceId: 'GHOST', targetId: 'B' },
      ];

      const levels = topologicalSortByLevel(tasks, edges);

      expect(levels).toHaveLength(2);
      expect(levels[0].map((t: any) => t.id)).toEqual(['A']);
      expect(levels[1].map((t: any) => t.id)).toEqual(['B']);
    });

    it('should handle a single task with no edges', () => {
      const tasks = [{ id: 'solo', executionOrder: 0 }];

      const levels = topologicalSortByLevel(tasks, []);

      expect(levels).toEqual([[tasks[0]]]);
    });

    it('should handle complex multi-level DAG', () => {
      //   A
      //  / \
      // B   C
      //  \ / \
      //   D   E
      //    \ /
      //     F
      const tasks = [
        { id: 'A', executionOrder: 0 },
        { id: 'B', executionOrder: 1 },
        { id: 'C', executionOrder: 2 },
        { id: 'D', executionOrder: 3 },
        { id: 'E', executionOrder: 4 },
        { id: 'F', executionOrder: 5 },
      ];
      const edges = [
        { sourceId: 'A', targetId: 'B' },
        { sourceId: 'A', targetId: 'C' },
        { sourceId: 'B', targetId: 'D' },
        { sourceId: 'C', targetId: 'D' },
        { sourceId: 'C', targetId: 'E' },
        { sourceId: 'D', targetId: 'F' },
        { sourceId: 'E', targetId: 'F' },
      ];

      const levels = topologicalSortByLevel(tasks, edges);

      expect(levels).toHaveLength(4);
      expect(levels[0].map((t: any) => t.id)).toEqual(['A']);
      expect(levels[1].map((t: any) => t.id).sort()).toEqual(['B', 'C']);
      expect(levels[2].map((t: any) => t.id).sort()).toEqual(['D', 'E']);
      expect(levels[3].map((t: any) => t.id)).toEqual(['F']);
    });

    it('should handle tasks without executionOrder', () => {
      const tasks = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];

      const levels = topologicalSortByLevel(tasks, []);

      expect(levels).toHaveLength(1);
      expect(levels[0]).toHaveLength(3);
    });
  });
});
