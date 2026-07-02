import { PlaybookFlowIntentTraceService } from './playbook-flow-intent-trace.service';
import type { PlaybookIntentTraceEntry } from '../interfaces/playbook-flow-intent-trace.interface';

function entry(stage: PlaybookIntentTraceEntry['stage'], index: number): PlaybookIntentTraceEntry {
  return {
    stage,
    model: 'gpt-test',
    systemPrompt: `system-${index}`,
    userPrompt: `user-${index}`,
    rawOutput: `raw-${index}`,
    createdAt: new Date(2026, 0, 1, 0, 0, index).toISOString(),
  };
}

describe('PlaybookFlowIntentTraceService', () => {
  let service: PlaybookFlowIntentTraceService;

  beforeEach(() => {
    service = new PlaybookFlowIntentTraceService();
  });

  it('returns empty response when no traces recorded', () => {
    expect(service.list('user-1', 'flow-1')).toEqual({ intentAnalyze: [], designAssessment: [] });
  });

  it('groups traces by stage', () => {
    service.push('user-1', 'flow-1', entry('intent.analyze', 1));
    service.push('user-1', 'flow-1', entry('intent.design_assessment', 2));
    service.push('user-1', 'flow-1', entry('intent.analyze', 3));

    const result = service.list('user-1', 'flow-1');
    expect(result.intentAnalyze.map((item) => item.userPrompt)).toEqual(['user-1', 'user-3']);
    expect(result.designAssessment.map((item) => item.userPrompt)).toEqual(['user-2']);
  });

  it('caps each buffer at 10 entries (FIFO)', () => {
    for (let index = 0; index < 12; index += 1) {
      service.push('user-1', 'flow-1', entry('intent.analyze', index));
    }
    const result = service.list('user-1', 'flow-1');
    expect(result.intentAnalyze).toHaveLength(10);
    expect(result.intentAnalyze[0].userPrompt).toBe('user-2');
    expect(result.intentAnalyze[9].userPrompt).toBe('user-11');
  });

  it('isolates buffers per user and per flow', () => {
    service.push('user-1', 'flow-1', entry('intent.analyze', 1));
    service.push('user-2', 'flow-1', entry('intent.analyze', 2));
    service.push('user-1', 'flow-2', entry('intent.analyze', 3));

    expect(service.list('user-1', 'flow-1').intentAnalyze).toHaveLength(1);
    expect(service.list('user-2', 'flow-1').intentAnalyze).toHaveLength(1);
    expect(service.list('user-1', 'flow-2').intentAnalyze).toHaveLength(1);
  });

  it('returns the latest entry of a given stage', () => {
    service.push('user-1', 'flow-1', entry('intent.analyze', 1));
    service.push('user-1', 'flow-1', entry('intent.design_assessment', 2));
    service.push('user-1', 'flow-1', entry('intent.analyze', 3));

    expect(service.latest('user-1', 'flow-1', 'intent.analyze')?.userPrompt).toBe('user-3');
    expect(service.latest('user-1', 'flow-1', 'intent.design_assessment')?.userPrompt).toBe('user-2');
    expect(service.latest('user-1', 'flow-1', 'intent.design_assessment')).not.toBeNull();
  });

  it('returns null when no trace of requested stage exists', () => {
    service.push('user-1', 'flow-1', entry('intent.analyze', 1));
    expect(service.latest('user-1', 'flow-1', 'intent.design_assessment')).toBeNull();
    expect(service.latest('unknown', 'flow-1', 'intent.analyze')).toBeNull();
  });

  it('clears the buffer for a flow', () => {
    service.push('user-1', 'flow-1', entry('intent.analyze', 1));
    service.clear('user-1', 'flow-1');
    expect(service.list('user-1', 'flow-1').intentAnalyze).toEqual([]);
  });
});