import { describe, expect, it, vi } from 'vitest';
import { PyodideWorkerController } from '../PyodideWorkerController';
import { PyodideExecutionResult, WorkerRequest, WorkerResponse } from '../protocol';

class FakeWorker {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  readonly postMessage = vi.fn<(message: WorkerRequest) => void>();
  readonly terminate = vi.fn();
}

function controllerWith(worker: FakeWorker, maxIdleMs = 1000): PyodideWorkerController {
  return new PyodideWorkerController({
    indexUrl: 'https://cdn.example/full/',
    createWorker: () => worker as unknown as Worker,
    maxIdleMs,
  });
}

const result: PyodideExecutionResult = {
  ok: true,
  result: 2,
  stdout: '',
  stderr: '',
  execution: { runtime: 'pyodide', durationMs: 1, coldStart: false, loadedPackages: [] },
};

describe('PyodideWorkerController', () => {
  it('creates the worker lazily, initializes it and relays results', async () => {
    const worker = new FakeWorker();
    const controller = controllerWith(worker);

    const pending = controller.execute('exec-1', '1 + 1', null, 5000);

    expect(worker.postMessage).toHaveBeenNthCalledWith(1, { type: 'init', indexUrl: 'https://cdn.example/full/' });
    expect(worker.postMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: 'execute', executionId: 'exec-1' }));

    worker.onmessage?.({ data: { type: 'result', executionId: 'exec-1', result } } as MessageEvent<WorkerResponse>);
    await expect(pending).resolves.toBe(result);
  });

  it('terminates the worker on timeout and reports a deterministic error', async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const controller = controllerWith(worker);

      const pending = controller.execute('exec-1', 'while True: pass', null, 3000);
      vi.advanceTimersByTime(3000);

      expect(worker.terminate).toHaveBeenCalled();
      await expect(pending).resolves.toMatchObject({ ok: false, error: { code: 'PYODIDE_EXECUTION_TIMEOUT' } });
      expect(controller.isStarted).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops an idle worker after the configured delay', async () => {
    vi.useFakeTimers();
    try {
      const worker = new FakeWorker();
      const controller = controllerWith(worker, 1000);

      const pending = controller.execute('exec-1', '1', null, 5000);
      worker.onmessage?.({ data: { type: 'result', executionId: 'exec-1', result } } as MessageEvent<WorkerResponse>);
      await pending;

      vi.advanceTimersByTime(1000);
      expect(worker.terminate).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
