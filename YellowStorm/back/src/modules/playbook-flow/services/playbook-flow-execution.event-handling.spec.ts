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
      isEnabled: jest.fn(),
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
      [{ port_id: 'report', artifact_kind: 'document', filename: 'report.pdf', url: 'https://example.com/report.pdf' }],
      [{ type: 'text', data: { content: 'Executive summary' } }],
      expect.objectContaining({
        reasoningChain: [{ id: 'step_1', type: 'observation', label: 'Identify', description: 'Picked the answer.' }],
      }),
    );
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
});
