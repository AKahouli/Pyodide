import { createExecutionServiceForTests } from './playbook-flow-execution.test-support';

describe('PlaybookFlowExecutionService event handling', () => {
  it('routes NodeToken through the token buffer when enabled', async () => {
    const tokenBufferService = {
      isEnabled: jest.fn().mockReturnValue(true),
      appendToken: jest.fn().mockResolvedValue(undefined),
      flushTask: jest.fn(),
      flushExecution: jest.fn(),
    };
    const { service, taskResultRepository, streamEvents } = createExecutionServiceForTests({ tokenBufferService });

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeToken',
      node_id: 'step-1',
      iteration: 2,
      payload: { token: 'Hello' },
    });

    expect(tokenBufferService.appendToken).toHaveBeenCalledWith(
      { executionId: 'exec-1', taskId: 'step-1', iteration: 2 },
      'Hello',
    );
    expect(taskResultRepository.appendOutput).not.toHaveBeenCalled();
    expect(taskResultRepository.upsert).not.toHaveBeenCalled();
    expect(streamEvents.emitStepUpdate).not.toHaveBeenCalled();
  });

  it('flushes buffered task tokens before persisting a completed node result', async () => {
    const tokenBufferService = {
      isEnabled: jest.fn().mockReturnValue(true),
      appendToken: jest.fn(),
      flushTask: jest.fn().mockResolvedValue(undefined),
      flushExecution: jest.fn(),
    };
    const { service, taskResultRepository } = createExecutionServiceForTests({ tokenBufferService });

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeCompleted',
      node_id: 'step-1',
      iteration: 1,
      payload: { output: 'done' },
    });

    expect(tokenBufferService.flushTask).toHaveBeenCalledWith({
      executionId: 'exec-1',
      taskId: 'step-1',
      iteration: 1,
    });
    expect(taskResultRepository.upsert).toHaveBeenCalled();
    expect(tokenBufferService.flushTask.mock.invocationCallOrder[0]).toBeLessThan(taskResultRepository.upsert.mock.invocationCallOrder[0]);
  });

  it('streams trace updates while a node is running', async () => {
    const { service, taskResultRepository, streamEvents } = createExecutionServiceForTests();

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeTraceUpdate',
      node_id: 'step-1',
      iteration: 1,
      payload: {
        tool_trace: [{ call_index: 0, tool_name: 'search', args: { q: 'hello' }, status: 'completed' }],
        llm_prompt_trace: [{ stage: 'initial_request', model: 'gpt-5.4-mini', prompt: 'prompt', generated_output: 'answer' }],
        usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3, model: 'gpt-5.4-mini' },
      },
    });

    expect(taskResultRepository.upsert).toHaveBeenCalledWith(
      { executionId: 'exec-1', taskId: 'step-1', iteration: 1 },
      expect.objectContaining({
        toolTrace: [expect.objectContaining({ callIndex: 0, toolName: 'search', args: { q: 'hello' }, status: 'completed' })],
        llmPromptTrace: [{ stage: 'initial_request', model: 'gpt-5.4-mini', prompt: 'prompt', generatedOutput: 'answer' }],
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, model: 'gpt-5.4-mini' },
      }),
      expect.objectContaining({ startedAt: expect.any(Date) }),
    );
    expect(streamEvents.emitStepUpdate).toHaveBeenCalledWith(
      'exec-1',
      'step-1',
      undefined,
      expect.objectContaining({
        toolTrace: [expect.objectContaining({ toolName: 'search' })],
        llmPromptTrace: [{ stage: 'initial_request', model: 'gpt-5.4-mini', prompt: 'prompt', generatedOutput: 'answer' }],
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
        modelName: 'gpt-5.4-mini',
      }),
    );
  });

  it('preserves sensitive trace text while always removing storage paths', async () => {
    const { service, taskResultRepository, streamEvents } = createExecutionServiceForTests();
    jest.spyOn((service as any).observabilityService, 'shouldRedactSensitiveText').mockResolvedValue(false);
    const trace = {
      tool_trace: [{
        tool_name: 'shell',
        args: {
          authorization: 'Bearer abc',
          command: 'cat /mnt/workspace/cv.docx then ceph://private/report.pdf',
          storagePath: 'owner/system_exec-1/private/report.pdf',
        },
        output_summary: 'See https://host/file?x-amz-signature=secret',
      }],
      llm_prompt_trace: [{ stage: 'initial_request', model: 'test', prompt: 'Bearer abc', generated_output: 'token=abc' }],
    };

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeTraceUpdate', node_id: 'step-1', iteration: 0, payload: trace,
    });

    const persistedTrace = taskResultRepository.upsert.mock.calls[0][1];
    expect(persistedTrace.toolTrace[0].args).toEqual({
      authorization: 'Bearer abc',
      command: 'cat /mnt/workspace/cv.docx then [REDACTED]',
    });
    expect(persistedTrace.toolTrace[0].outputSummary).toBe('See [REDACTED]');
    expect(persistedTrace.llmPromptTrace[0].prompt).toBe('Bearer abc');
    expect(streamEvents.emitStepUpdate.mock.calls[0][3].toolTrace).toEqual(persistedTrace.toolTrace);

    taskResultRepository.upsert.mockClear();
    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeCompleted', node_id: 'step-1', iteration: 0, payload: { output: 'done', ...trace },
    });

    const completedTrace = taskResultRepository.upsert.mock.calls[0][1];
    expect(completedTrace.toolTrace).toEqual(persistedTrace.toolTrace);
    expect(completedTrace.llmPromptTrace[0].prompt).toBe('Bearer abc');
  });

  it('flushes buffered execution tokens before marking execution failed', async () => {
    const tokenBufferService = {
      isEnabled: jest.fn(),
      appendToken: jest.fn(),
      flushTask: jest.fn(),
      flushExecution: jest.fn().mockResolvedValue(undefined),
    };
    const { service, executionRepository } = createExecutionServiceForTests({ tokenBufferService });

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'ExecutionFailed',
      payload: { error: 'boom' },
    });

    expect(tokenBufferService.flushExecution).toHaveBeenCalledWith('exec-1');
    expect(executionRepository.transition).toHaveBeenCalledWith('exec-1', {
      from: ['queued', 'running', 'pending_approval'],
      patch: { status: 'failed', error: 'boom', endedAt: expect.any(Date) },
    });
    expect(tokenBufferService.flushExecution.mock.invocationCallOrder[0]).toBeLessThan(executionRepository.transition.mock.invocationCallOrder[0]);
  });

  it('redacts private paths from failed node persistence and stream events', async () => {
    const { service, taskResultRepository, streamEvents } = createExecutionServiceForTests();

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeFailed',
      node_id: 'step-1',
      iteration: 0,
      payload: { error: 'Failed while reading /mnt/workspace/private/report.pdf' },
    });

    expect(taskResultRepository.upsert).toHaveBeenCalledWith(
      { executionId: 'exec-1', taskId: 'step-1', iteration: 0 },
      expect.objectContaining({ status: 'failed', error: 'Failed while reading [REDACTED]' }),
      expect.objectContaining({ startedAt: expect.any(Date) }),
    );
    expect(streamEvents.emitStepComplete).toHaveBeenCalledWith(
      'exec-1', 'step-1', undefined, 'Failed while reading [REDACTED]', 0,
    );
  });

  it('ignores replayed HITL interrupts that were already answered', async () => {
    const executionRepository = {
      isInterruptStale: jest.fn().mockResolvedValue(true),
    };
    const { service, taskResultRepository, streamEvents } = createExecutionServiceForTests({ executionRepository });

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeSuspended',
      node_id: 'step-1',
      iteration: 0,
      payload: {
        type: 'clarification',
        interrupt_id: 'step-1:clarification:1',
        message: 'Which country?',
      },
    });

    expect(executionRepository.isInterruptStale).toHaveBeenCalledWith('exec-1', 'step-1:clarification:1');
    expect(taskResultRepository.upsert).not.toHaveBeenCalled();
    expect(streamEvents.emitInterrupt).not.toHaveBeenCalled();
  });

  it('persists enriched node results without collapsing metadata into output', async () => {
    const { service, taskResultRepository, streamEvents } = createExecutionServiceForTests();

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeCompleted',
      node_id: 'step-1',
      iteration: 0,
      payload: {
        output: 'Executive summary\n---PUBLIC_REASONING_TRACE_JSON---\n[{"id":"step_1","type":"observation","label":"Identify","description":"Picked the answer."}]',
        display_text: 'Executive summary\n---PUBLIC_REASONING_TRACE_JSON---\n[{"id":"step_1","type":"observation","label":"Identify","description":"Picked the answer."}]',
        artifacts: [{ port_id: 'report', artifact_kind: 'document', filename: 'report.pdf', url: 'https://example.com/report.pdf' }],
        components: [{ type: 'text', data: { content: 'Executive summary' } }],
      },
    });

    expect(taskResultRepository.upsert).toHaveBeenCalledWith(
      { executionId: 'exec-1', taskId: 'step-1', iteration: 0 },
      expect.objectContaining({
        status: 'completed',
        output: 'Executive summary',
        displayText: 'Executive summary',
        reasoningChain: [{ id: 'step_1', type: 'observation', label: 'Identify', description: 'Picked the answer.' }],
        artifacts: [{ port_id: 'report', artifact_kind: 'document', filename: 'report.pdf', url: 'https://example.com/report.pdf' }],
        components: [{ type: 'text', data: { content: 'Executive summary' } }],
      }),
      expect.objectContaining({ startedAt: expect.any(Date) }),
    );
    expect(streamEvents.emitStepComplete).toHaveBeenCalledWith(
      'exec-1',
      'step-1',
      'Executive summary',
      undefined,
      0,
      [{ port_id: 'report', artifact_kind: 'document', filename: 'report.pdf' }],
      [{ type: 'text', data: { content: 'Executive summary' } }],
      expect.objectContaining({
        reasoningChain: [{ id: 'step_1', type: 'observation', label: 'Identify', description: 'Picked the answer.' }],
      }),
    );
  });

  it('preserves public source links and redacts signed links in completed SSE', async () => {
    const { service, streamEvents } = createExecutionServiceForTests();

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeCompleted',
      node_id: 'step-1',
      iteration: 0,
      payload: {
        output: 'Research complete',
        components: [{
          type: 'sources',
          data: {
            sources: [
              { title: 'Public source', url: 'https://example.com/article' },
              { title: 'Storage source', url: 'https://storage.example/private.pdf?X-Amz-Signature=secret' },
            ],
          },
        }],
      },
    });

    const components = streamEvents.emitStepComplete.mock.calls[0][6];
    expect(components[0].data.sources[0].url).toBe('https://example.com/article');
    expect(components[0].data.sources[1].url).toBe('[REDACTED]');
  });

  it('does not fail task completion when public reasoning JSON is malformed', async () => {
    const { service, taskResultRepository } = createExecutionServiceForTests();

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeCompleted',
      node_id: 'step-1',
      iteration: 0,
      payload: {
        output: 'Executive summary\n---PUBLIC_REASONING_TRACE_JSON---\n{',
      },
    });

    expect(taskResultRepository.upsert).toHaveBeenCalledWith(
      { executionId: 'exec-1', taskId: 'step-1', iteration: 0 },
      expect.objectContaining({
        status: 'completed',
        output: 'Executive summary',
        reasoningChain: [],
        traceMetadata: expect.objectContaining({
          publicReasoning: expect.objectContaining({ parseError: 'invalid_json' }),
        }),
      }),
      expect.objectContaining({ startedAt: expect.any(Date) }),
    );
  });

  it('does not emit completed after a reserved router cancellation already won', async () => {
    // The cancellation's guarded transition wins; the completion's finds the run terminal.
    const executionRepository = {
      transition: jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
      findById: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }),
    };
    const { service, streamEvents } = createExecutionServiceForTests({ executionRepository });

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'RouterDecision',
      node_id: 'router-1',
      iteration: 0,
      payload: { label: '__cancelled__' },
    });
    await (service as any).handleRunEvent('exec-1', {
      event_type: 'ExecutionCompleted',
      node_id: '',
      iteration: 0,
      payload: {},
    });

    expect(streamEvents.emitExecutionComplete).toHaveBeenCalledTimes(1);
    expect(streamEvents.emitExecutionComplete).toHaveBeenCalledWith(
      'exec-1',
      'cancelled',
      'Router router-1 returned __cancelled__',
    );
  });

  it('marks the execution failed when the runtime completes after a task failure', async () => {
    const { service, taskResultRepository, executionRepository, streamEvents } = createExecutionServiceForTests();
    taskResultRepository.findLatestFailed.mockResolvedValue({ error: 'upstream failed' });

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'ExecutionCompleted',
      node_id: '',
      iteration: 0,
      payload: {},
    });

    expect(taskResultRepository.findLatestFailed).toHaveBeenCalledWith('exec-1');
    expect(executionRepository.transition).toHaveBeenCalledWith('exec-1', {
      from: ['queued', 'running', 'pending_approval'],
      patch: { status: 'failed', error: 'upstream failed', endedAt: expect.any(Date) },
    });
    expect(executionRepository.transition).not.toHaveBeenCalledWith('exec-1', expect.objectContaining({ patch: expect.objectContaining({ status: 'completed' }) }));
    expect(streamEvents.emitExecutionComplete).toHaveBeenCalledWith('exec-1', 'failed', 'upstream failed');
  });

  it('persists and streams iterator child step starts per iteration turn', async () => {
    const { service, taskResultRepository, streamEvents } = createExecutionServiceForTests();
    taskResultRepository.find.mockResolvedValue(null);

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'IteratorChildStepStarted',
      node_id: 'iter-node',
      iteration: 0,
      payload: { iterationIndex: 0, taskId: 'child-step', taskTitle: 'Process Item', status: 'running' },
    });

    const persisted = taskResultRepository.upsert.mock.calls[0][1].iteratorIterations;
    expect(taskResultRepository.upsert.mock.calls[0][2]).toEqual({ startedAt: expect.any(Date), status: 'running' });
    expect(persisted[0].index).toBe(0);
    expect(persisted[0].status).toBe('running');
    expect(persisted[0].childResults[0]).toEqual(expect.objectContaining({ taskId: 'child-step', status: 'running' }));
    expect(streamEvents.emitIteratorChildStepStarted).toHaveBeenCalledWith(
      'exec-1',
      'iter-node',
      expect.objectContaining({ iterationIndex: 0, taskId: 'child-step', status: 'running' }),
    );
  });

  it('persists and streams iterator child step completions per iteration turn', async () => {
    const { service, taskResultRepository, streamEvents } = createExecutionServiceForTests();
    taskResultRepository.find.mockResolvedValue({
      iteratorIterations: [
        { index: 0, status: 'running', output: null, error: null, childResults: [{ taskId: 'child-step', taskTitle: 'Process Item', status: 'running' }] },
      ],
    });

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'IteratorChildStepCompleted',
      node_id: 'iter-node',
      iteration: 0,
      payload: { iterationIndex: 0, taskId: 'child-step', taskTitle: 'Process Item', status: 'completed', output: 'result text' },
    });

    expect(taskResultRepository.find).toHaveBeenCalledWith(
      { executionId: 'exec-1', taskId: 'iter-node', iteration: 0 },
      { light: true, with: ['iteratorIterations'] },
    );
    const persisted = taskResultRepository.upsert.mock.calls[0][1].iteratorIterations;
    expect(persisted).toHaveLength(1);
    expect(persisted[0].status).toBe('completed');
    expect(persisted[0].childResults[0]).toEqual(
      expect.objectContaining({ taskId: 'child-step', status: 'completed', output: 'result text' }),
    );
    expect(streamEvents.emitIteratorChildStepCompleted).toHaveBeenCalledWith(
      'exec-1',
      'iter-node',
      expect.objectContaining({ iterationIndex: 0, taskId: 'child-step', status: 'completed', output: 'result text' }),
    );
  });
});
