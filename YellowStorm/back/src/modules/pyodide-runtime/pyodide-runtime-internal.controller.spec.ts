import { ConfigService } from '@nestjs/config';
import { PyodideRuntimeInternalController } from './pyodide-runtime-internal.controller';
import { PyodideRuntimeDispatcher } from './pyodide-runtime.dispatcher';
import { PyodideErrorCode, PyodideExecutionResult } from './pyodide-runtime.types';

const USER_ID = '65f000000000000000000001';
const request = { headers: { 'x-yellowstorm-user-id': USER_ID } };

function configWith(enabled: boolean): ConfigService {
  return { get: jest.fn((key: string, fallback: unknown) => (key === 'pyodideRuntime.enabled' ? enabled : fallback)) } as unknown as ConfigService;
}

const result: PyodideExecutionResult = {
  ok: true,
  result: 2,
  stdout: '2\n',
  stderr: '',
  execution: { runtime: 'pyodide', durationMs: 1, coldStart: false, loadedPackages: [] },
};

describe('PyodideRuntimeInternalController', () => {
  it('returns offline without dispatching when the runtime is disabled', async () => {
    const dispatcher = { execute: jest.fn() } as unknown as PyodideRuntimeDispatcher;
    const controller = new PyodideRuntimeInternalController(dispatcher, configWith(false));

    const response = await controller.execute(request, { code: '1 + 1' });

    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe(PyodideErrorCode.RUNTIME_OFFLINE);
    expect(dispatcher.execute).not.toHaveBeenCalled();
  });

  it('forwards the trusted user and defaults the timeout when enabled', async () => {
    const dispatcher = { execute: jest.fn().mockResolvedValue(result) } as unknown as PyodideRuntimeDispatcher;
    const controller = new PyodideRuntimeInternalController(dispatcher, configWith(true));

    const response = await controller.execute(request, { code: '1 + 1', input: { a: 1 } });

    expect(response).toEqual(result);
    expect(dispatcher.execute).toHaveBeenCalledWith(USER_ID, {
      code: '1 + 1',
      input: { a: 1 },
      timeoutMs: 30_000,
    });
  });
});
