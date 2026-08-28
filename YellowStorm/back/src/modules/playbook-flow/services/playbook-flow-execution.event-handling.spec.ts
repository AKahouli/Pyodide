import { createExecutionServiceForTests } from './playbook-flow-execution.test-support';

describe('PlaybookFlowExecutionService event handling', () => {
  it('routes NodeToken through the token buffer when enabled', async () => {
    const tokenBufferService = {
      isEnabled: jest.fn().mockReturnValue(true),
      appendToken: jest.fn().mockResolvedValue(undefined),
      flushTask: jest.fn(),
      flushExecution: jest.fn(),
    };
    const { service, taskResultModel, streamEvents } = createExecutionServiceForTests({ tokenBufferService });

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
    expect(taskResultModel.updateOne).not.toHaveBeenCalled();
    expect(streamEvents.emitStepUpdate).not.toHaveBeenCalled();
  });

  it('flushes buffered task tokens before persisting a completed node result', async () => {
    const tokenBufferService = {
      isEnabled: jest.fn().mockReturnValue(true),
      appendToken: jest.fn(),
      flushTask: jest.fn().mockResolvedValue(undefined),
      flushExecution: jest.fn(),
    };
    const { service, taskResultModel } = createExecutionServiceForTests({ tokenBufferService });
    taskResultModel.updateOne.mockResolvedValue(undefined);

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
    expect(taskResultModel.updateOne).toHaveBeenCalled();
  });

  it('streams trace updates while a node is running', async () => {
    const { service, taskResultModel, streamEvents } = createExecutionServiceForTests();
    taskResultModel.updateOne.mockResolvedValue(undefined);

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

    expect(taskResultModel.updateOne).toHaveBeenCalledWith(
      { executionId: 'exec-1', taskId: 'step-1', iteration: 1 },
      expect.objectContaining({
        $set: expect.objectContaining({
          toolTrace: [expect.objectContaining({ callIndex: 0, toolName: 'search', args: { q: 'hello' }, status: 'completed' })],
          llmPromptTrace: [{ stage: 'initial_request', model: 'gpt-5.4-mini', prompt: 'prompt', generatedOutput: 'answer' }],
          usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3, model: 'gpt-5.4-mini' },
        }),
      }),
      { upsert: true },
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
    const { service, taskResultModel, streamEvents } = createExecutionServiceForTests();
    jest.spyOn((service as any).observabilityService, 'shouldRedactSensitiveText').mockResolvedValue(false);
    taskResultModel.updateOne.mockResolvedValue(undefined);
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

    const persistedTrace = taskResultModel.updateOne.mock.calls[0][1].$set;
    expect(persistedTrace.toolTrace[0].args).toEqual({
      authorization: 'Bearer abc',
      command: 'cat /mnt/workspace/cv.docx then [REDACTED]',
    });
    expect(persistedTrace.toolTrace[0].outputSummary).toBe('See [REDACTED]');
    expect(persistedTrace.llmPromptTrace[0].prompt).toBe('Bearer abc');
    expect(streamEvents.emitStepUpdate.mock.calls[0][3].toolTrace).toEqual(persistedTrace.toolTrace);

    taskResultModel.updateOne.mockClear();
    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeCompleted', node_id: 'step-1', iteration: 0, payload: { output: 'done', ...trace },
    });

    const completedTrace = taskResultModel.updateOne.mock.calls[0][1].$set;
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
    const { service, executionModel } = createExecutionServiceForTests({ tokenBufferService });

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'ExecutionFailed',
      payload: { error: 'boom' },
    });

    expect(tokenBufferService.flushExecution).toHaveBeenCalledWith('exec-1');
    expect(executionModel.updateOne).toHaveBeenCalledWith(
      { _id: 'exec-1', status: { $nin: ['completed', 'failed', 'cancelled'] } },
      { status: 'failed', error: 'boom', endedAt: expect.any(Date) },
    );
  });

  it('redacts private paths from failed node persistence and stream events', async () => {
    const { service, taskResultModel, streamEvents } = createExecutionServiceForTests();
    taskResultModel.updateOne.mockResolvedValue(undefined);

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeFailed',
      node_id: 'step-1',
      iteration: 0,
      payload: { error: 'Failed while reading /mnt/workspace/private/report.pdf' },
    });

    expect(taskResultModel.updateOne).toHaveBeenCalledWith(
      { executionId: 'exec-1', taskId: 'step-1', iteration: 0 },
      expect.objectContaining({ $set: expect.objectContaining({ error: 'Failed while reading [REDACTED]' }) }),
      { upsert: true },
    );
    expect(streamEvents.emitStepComplete).toHaveBeenCalledWith(
      'exec-1', 'step-1', undefined, 'Failed while reading [REDACTED]', 0,
    );
  });

  it('ignores replayed HITL interrupts that were already answered', async () => {
    const executionModel = {
      exists: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ _id: 'exec-1' }) })),
    };
    const { service, taskResultModel, streamEvents } = createExecutionServiceForTests({ executionModel });

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

    expect(executionModel.exists).toHaveBeenCalledWith({
      _id: 'exec-1',
      $or: [
        { status: { $in: ['completed', 'failed', 'cancelled'] } },
        { hitlEvents: { $elemMatch: { interruptId: 'step-1:clarification:1', status: 'answered' } } },
      ],
    });
    expect(taskResultModel.updateOne).not.toHaveBeenCalled();
    expect(streamEvents.emitInterrupt).not.toHaveBeenCalled();
  });

  it('persists enriched node results without collapsing metadata into output', async () => {
    const { service, taskResultModel, streamEvents } = createExecutionServiceForTests();
    taskResultModel.updateOne.mockResolvedValue(undefined);

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

    expect(taskResultModel.updateOne).toHaveBeenCalledWith(
      { executionId: 'exec-1', taskId: 'step-1', iteration: 0 },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'completed',
          output: 'Executive summary',
          displayText: 'Executive summary',
          reasoningChain: [{ id: 'step_1', type: 'observation', label: 'Identify', description: 'Picked the answer.' }],
          artifacts: [{ port_id: 'report', artifact_kind: 'document', filename: 'report.pdf', url: 'https://example.com/report.pdf' }],
          components: [{ type: 'text', data: { content: 'Executive summary' } }],
        }),
      }),
      { upsert: true },
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
    const { service, taskResultModel, streamEvents } = createExecutionServiceForTests();
    taskResultModel.updateOne.mockResolvedValue(undefined);

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
    const { service, taskResultModel } = createExecutionServiceForTests();
    taskResultModel.updateOne.mockResolvedValue(undefined);

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'NodeCompleted',
      node_id: 'step-1',
      iteration: 0,
      payload: {
        output: 'Executive summary\n---PUBLIC_REASONING_TRACE_JSON---\n{',
      },
    });

    expect(taskResultModel.updateOne).toHaveBeenCalledWith(
      { executionId: 'exec-1', taskId: 'step-1', iteration: 0 },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'completed',
          output: 'Executive summary',
          reasoningChain: [],
          traceMetadata: expect.objectContaining({
            publicReasoning: expect.objectContaining({ parseError: 'invalid_json' }),
          }),
        }),
      }),
      { upsert: true },
    );
  });

  it('does not emit completed after a reserved router cancellation already won', async () => {
    const executionModel = {
      updateOne: jest
        .fn()
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })
        .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) }),
      findById: jest.fn(() => ({ lean: jest.fn().mockResolvedValue({ ownerId: 'owner-1' }) })),
    };
    const { service, streamEvents } = createExecutionServiceForTests({ executionModel });

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
    const { service, taskResultModel, executionModel, streamEvents } = createExecutionServiceForTests();
    taskResultModel.findOne.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue({ error: 'upstream failed' }),
    });

    await (service as any).handleRunEvent('exec-1', {
      event_type: 'ExecutionCompleted',
      node_id: '',
      iteration: 0,
      payload: {},
    });

    expect(executionModel.updateOne).toHaveBeenCalledWith(
      { _id: 'exec-1', status: { $nin: ['completed', 'failed', 'cancelled'] } },
      { status: 'failed', error: 'upstream failed', endedAt: expect.any(Date) },
    );
    expect(streamEvents.emitExecutionComplete).toHaveBeenCalledWith('exec-1', 'failed', 'upstream failed');
  });
});
