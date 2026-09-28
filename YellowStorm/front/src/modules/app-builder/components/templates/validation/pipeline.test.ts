import { describe, it, expect, vi } from 'vitest';
import { runValidationPipeline, type ValidationStep, type ValidationStepContext } from './pipeline';

function makeCtx(): ValidationStepContext {
  const controller = new AbortController();
  return { templateId: 'tpl', signal: controller.signal, setSessionId: vi.fn() };
}

describe('runValidationPipeline', () => {
  it('runs steps in order and marks them confirmed', async () => {
    const order: string[] = [];
    const steps: ValidationStep[] = [
      { id: 'a', labelKey: 'validation.nodepod', run: async () => { order.push('a'); } },
      { id: 'b', labelKey: 'validation.nodepod', run: async () => { order.push('b'); } },
    ];
    const progress: string[][] = [];
    await runValidationPipeline(steps, makeCtx(), (s) => progress.push(s.map((x) => `${x.id}:${x.status}`)));

    expect(order).toEqual(['a', 'b']);
    expect(progress.at(-1)).toEqual(['a:confirmed', 'b:confirmed']);
  });

  it('stops at the first failure and reports it', async () => {
    const ran: string[] = [];
    const steps: ValidationStep[] = [
      { id: 'a', labelKey: 'validation.nodepod', run: async () => { ran.push('a'); } },
      { id: 'b', labelKey: 'validation.nodepod', run: async () => { ran.push('b'); throw new Error('boom'); } },
      { id: 'c', labelKey: 'validation.nodepod', run: async () => { ran.push('c'); } },
    ];
    let last: string[] = [];
    await expect(
      runValidationPipeline(steps, makeCtx(), (s) => { last = s.map((x) => `${x.id}:${x.status}`); }),
    ).rejects.toThrow('boom');

    expect(ran).toEqual(['a', 'b']);
    expect(last).toEqual(['a:confirmed', 'b:failed', 'c:pending']);
  });
});
