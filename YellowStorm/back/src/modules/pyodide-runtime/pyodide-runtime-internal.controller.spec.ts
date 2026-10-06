import { ConfigService } from '@nestjs/config';
import { PyodideFileResolver } from './pyodide-file.resolver';
import { PyodideRuntimeInternalController } from './pyodide-runtime-internal.controller';
import { PyodideRuntimeDispatcher } from './pyodide-runtime.dispatcher';
import { PyodideErrorCode, PyodideExecutionResult } from './pyodide-runtime.types';

const USER_ID = '65f000000000000000000001';
const WORKSPACE_ID = '65f0000000000000000000aa';
const request = { headers: { 'x-yellowstorm-user-id': USER_ID } };
const fileRequest = { headers: { 'x-yellowstorm-user-id': USER_ID, 'x-yellowstorm-workspace-id': WORKSPACE_ID } };

function configWith(enabled: boolean): ConfigService {
  return { get: jest.fn((key: string, fallback: unknown) => (key === 'pyodideRuntime.enabled' ? enabled : fallback)) } as unknown as ConfigService;
}

function resolverStub(): PyodideFileResolver {
  return {
    resolveInputs: jest.fn().mockResolvedValue([]),
    persistOutputs: jest.fn().mockResolvedValue([]),
  } as unknown as PyodideFileResolver;
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
    const controller = new PyodideRuntimeInternalController(dispatcher, resolverStub(), configWith(false));

    const response = await controller.execute(request, { code: '1 + 1' });

    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe(PyodideErrorCode.RUNTIME_OFFLINE);
    expect(dispatcher.execute).not.toHaveBeenCalled();
  });

  it('forwards the trusted user and defaults the timeout when enabled', async () => {
    const dispatcher = { execute: jest.fn().mockResolvedValue(result) } as unknown as PyodideRuntimeDispatcher;
    const controller = new PyodideRuntimeInternalController(dispatcher, resolverStub(), configWith(true));

    const response = await controller.execute(request, { code: '1 + 1', input: { a: 1 } });

    expect(response).toEqual(result);
    expect(dispatcher.execute).toHaveBeenCalledWith(USER_ID, expect.objectContaining({
      code: '1 + 1',
      input: { a: 1 },
      timeoutMs: 30_000,
      inputFiles: [],
    }));
  });

  it('refuses file operations without a trusted workspace context', async () => {
    const dispatcher = { execute: jest.fn() } as unknown as PyodideRuntimeDispatcher;
    const controller = new PyodideRuntimeInternalController(dispatcher, resolverStub(), configWith(true));

    const response = await controller.execute(request, { code: '1', inputs: [{ as: 'a.txt', documentId: 'x' }] });

    expect(response.error?.code).toBe('PYODIDE_EXECUTION_ERROR');
    expect(dispatcher.execute).not.toHaveBeenCalled();
  });

  it('injects resolved inputs and persists outputs as artifacts', async () => {
    const resolver = resolverStub();
    (resolver.resolveInputs as jest.Mock).mockResolvedValue([{ name: 'a.txt', mimeType: 'text/plain', contentBase64: 'YQ==' }]);
    (resolver.persistOutputs as jest.Mock).mockResolvedValue([{ name: 'out.csv', sizeBytes: 3, documentId: 'doc-1' }]);
    const dispatcher = {
      execute: jest.fn().mockResolvedValue({
        ...result,
        outputFiles: [{ name: 'out.csv', contentBase64: 'YSxi' }],
      }),
    } as unknown as PyodideRuntimeDispatcher;
    const controller = new PyodideRuntimeInternalController(dispatcher, resolver, configWith(true));

    const response = await controller.execute(fileRequest, {
      code: '1',
      inputs: [{ as: 'a.txt', documentId: 'doc-a' }],
      outputs: ['out.csv'],
    });

    expect(resolver.resolveInputs).toHaveBeenCalledWith(USER_ID, WORKSPACE_ID, [{ as: 'a.txt', documentId: 'doc-a' }]);
    expect(resolver.persistOutputs).toHaveBeenCalledWith(USER_ID, WORKSPACE_ID, [{ name: 'out.csv', contentBase64: 'YSxi' }]);
    expect(response.artifacts).toEqual([{ name: 'out.csv', sizeBytes: 3, documentId: 'doc-1' }]);
    expect(response.outputFiles).toBeUndefined();
  });
});
