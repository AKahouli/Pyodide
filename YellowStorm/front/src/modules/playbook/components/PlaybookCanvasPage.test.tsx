import { describe, expect, it } from 'vitest';
import { buildCanvasJudgeStateMap } from './PlaybookCanvasPage';
import { makeExecution } from '../test-utils';

describe('buildCanvasJudgeStateMap', () => {
  it('prefers an evaluated iteration over a stale evaluating iteration for the same task', () => {
    const taskResults = [
      { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 1, judgeStatus: 'evaluating', judgeResult: null },
      { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 0, judgeStatus: 'evaluated', judgeResult: { overallScore: 91 } },
    ] as any;

    const judgeState = buildCanvasJudgeStateMap(taskResults).get('task-1');

    expect(judgeState).toMatchObject({
      judgeStatus: 'evaluated',
      judgeResult: { overallScore: 91 },
      iteration: 0,
    });
  });

  it('prefers the latest iteration when judge states are equally complete', () => {
    const taskResults = [
      { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 0, judgeStatus: 'evaluated', judgeResult: { overallScore: 81 } },
      { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 1, judgeStatus: 'evaluated', judgeResult: { overallScore: 94 } },
    ] as any;

    const judgeState = buildCanvasJudgeStateMap(taskResults).get('task-1');

    expect(judgeState).toMatchObject({
      judgeStatus: 'evaluated',
      judgeResult: { overallScore: 94 },
      iteration: 1,
    });
  });

  it('keeps the richer evaluated result when a later duplicate lacks judge details', () => {
    const taskResults = [
      { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 0, judgeStatus: 'evaluated', judgeResult: { overallScore: 87 } },
      { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 1, judgeStatus: 'evaluated', judgeResult: null },
    ] as any;

    const judgeState = buildCanvasJudgeStateMap(taskResults).get('task-1');

    expect(judgeState).toMatchObject({
      judgeStatus: 'evaluated',
      judgeResult: { overallScore: 87 },
      iteration: 0,
    });
  });

  it('prefers a later failed state over an older evaluated score', () => {
    const taskResults = [
      { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 0, judgeStatus: 'evaluated', judgeResult: { overallScore: 87 } },
      { ...makeExecution().taskResults[0], taskId: 'task-1', iteration: 1, judgeStatus: 'failed', judgeResult: null },
    ] as any;

    const judgeState = buildCanvasJudgeStateMap(taskResults).get('task-1');

    expect(judgeState).toMatchObject({
      judgeStatus: 'failed',
      judgeResult: null,
      iteration: 1,
    });
  });

  it('keeps the more complete evaluated result when both duplicates have scores', () => {
    const taskResults = [
      {
        ...makeExecution().taskResults[0],
        taskId: 'task-1',
        iteration: 0,
        judgeStatus: 'evaluated',
        judgeResult: { overallScore: 87, reason: 'Detailed', rewriteHints: ['hint-1'] },
      },
      {
        ...makeExecution().taskResults[0],
        taskId: 'task-1',
        iteration: 1,
        judgeStatus: 'evaluated',
        judgeResult: { overallScore: 88 },
      },
    ] as any;

    const judgeState = buildCanvasJudgeStateMap(taskResults).get('task-1');

    expect(judgeState).toMatchObject({
      judgeStatus: 'evaluated',
      judgeResult: { overallScore: 87, reason: 'Detailed', rewriteHints: ['hint-1'] },
      iteration: 0,
    });
  });

  it('prefers the later evaluated result when both payloads are equally populated', () => {
    const taskResults = [
      {
        ...makeExecution().taskResults[0],
        taskId: 'task-1',
        iteration: 0,
        judgeStatus: 'evaluated',
        judgeResult: { overallScore: 87, reason: 'Older', rewriteHints: ['hint-1', 'hint-2'] },
      },
      {
        ...makeExecution().taskResults[0],
        taskId: 'task-1',
        iteration: 1,
        judgeStatus: 'evaluated',
        judgeResult: { overallScore: 92, reason: 'Newer', rewriteHints: [] },
      },
    ] as any;

    const judgeState = buildCanvasJudgeStateMap(taskResults).get('task-1');

    expect(judgeState).toMatchObject({
      judgeStatus: 'evaluated',
      judgeResult: { overallScore: 92, reason: 'Newer', rewriteHints: [] },
      iteration: 1,
    });
  });
});
