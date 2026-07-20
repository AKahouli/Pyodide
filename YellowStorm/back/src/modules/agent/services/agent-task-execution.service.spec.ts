import { EventEmitter } from 'events';
import { ServiceUnavailableException } from '../../exceptions';
import { AgentTaskExecutionService } from './agent-task-execution.service';

describe('AgentTaskExecutionService', () => {
  it('returns bounded structured tool results separately from assistant text', async () => {
    const call = Object.assign(new EventEmitter(), { cancel: jest.fn() });
    const stream = {
      waitForGrpcReady: jest.fn().mockResolvedValue(true),
      getChatbotClient: jest.fn().mockReturnValue({ RunSingleAgent: jest.fn().mockReturnValue(call) }),
    };
    const agents = {
      assertActiveDefaultAgent: jest.fn().mockResolvedValue(undefined),
      buildGrpcAgentsForPlaybook: jest.fn().mockResolvedValue([{ id: 'agent-1' }]),
    };
    const service = new AgentTaskExecutionService(
      { get: jest.fn().mockReturnValue(5_000) } as any,
      stream as any,
      agents as any,
      { recordUsage: jest.fn() } as any,
    );

    const resultPromise = service.runSingleAgentTask({
      userId: 'user-1',
      agentId: '507f1f77bcf86cd799439011',
      query: 'Inspect the Playbook',
      attachedFiles: [],
      correlationId: 'turn-1',
    });
    setImmediate(() => {
      call.emit('data', {
        action: 'update',
        component: {
          tool_info: {
            title: 'playbook-mcp_start_playbook_construction',
            status: 'completed',
            result_json: JSON.stringify({ operationId: 'operation-1' }),
          },
        },
      });
      call.emit('data', { action: 'add', component: { text: { content: 'Construction started.' } } });
      call.emit('end');
    });

    await expect(resultPromise).resolves.toEqual(expect.objectContaining({
      text: 'Construction started.',
      toolResults: [{
        name: 'playbook-mcp_start_playbook_construction',
        status: 'completed',
        result: { operationId: 'operation-1' },
      }],
    }));
  });

  it('ignores malformed structured tool results', async () => {
    const call = Object.assign(new EventEmitter(), { cancel: jest.fn() });
    const service = new AgentTaskExecutionService(
      { get: jest.fn().mockReturnValue(5_000) } as any,
      { waitForGrpcReady: jest.fn().mockResolvedValue(true), getChatbotClient: jest.fn().mockReturnValue({ RunSingleAgent: () => call }) } as any,
      { assertActiveDefaultAgent: jest.fn(), buildGrpcAgentsForPlaybook: jest.fn().mockResolvedValue([{}]) } as any,
      { recordUsage: jest.fn() } as any,
    );

    const resultPromise = service.runSingleAgentTask({ userId: 'user-1', agentId: '507f1f77bcf86cd799439011', query: 'Read', attachedFiles: [], correlationId: 'turn-2' });
    setImmediate(() => {
      call.emit('data', { component: { tool_info: { title: 'tool', status: 'completed', result_json: '{bad' } } });
      call.emit('end');
    });

    await expect(resultPromise).resolves.toEqual(expect.objectContaining({ toolResults: [] }));
  });

  it('returns only the final text component after tool execution', async () => {
    const call = Object.assign(new EventEmitter(), { cancel: jest.fn() });
    const service = new AgentTaskExecutionService(
      { get: jest.fn().mockReturnValue(5_000) } as any,
      { waitForGrpcReady: jest.fn().mockResolvedValue(true), getChatbotClient: jest.fn().mockReturnValue({ RunSingleAgent: () => call }) } as any,
      { assertActiveDefaultAgent: jest.fn(), buildGrpcAgentsForPlaybook: jest.fn().mockResolvedValue([{}]) } as any,
      { recordUsage: jest.fn() } as any,
    );

    const resultPromise = service.runSingleAgentTask({ userId: 'user-1', agentId: '507f1f77bcf86cd799439011', query: 'Read', attachedFiles: [], correlationId: 'turn-3' });
    setImmediate(() => {
      call.emit('data', { action: 'add', component: { id: 'planning', text: { content: 'I will inspect it.' } } });
      call.emit('data', { action: 'add', component: { id: 'answer', text: { content: 'The Playbook has ' } } });
      call.emit('data', { action: 'update', component: { id: 'answer', text: { content: 'seven tasks.' } } });
      call.emit('data', { action: 'add', component: { id: 'separator', text: { content: ' \n ' } } });
      call.emit('end');
    });

    await expect(resultPromise).resolves.toEqual(expect.objectContaining({ text: 'The Playbook has seven tasks.' }));
  });

  it('rejects a normally ended stream containing a terminal error component', async () => {
    const call = Object.assign(new EventEmitter(), { cancel: jest.fn() });
    const service = new AgentTaskExecutionService(
      { get: jest.fn().mockReturnValue(5_000) } as any,
      { waitForGrpcReady: jest.fn().mockResolvedValue(true), getChatbotClient: jest.fn().mockReturnValue({ RunSingleAgent: () => call }) } as any,
      { assertActiveDefaultAgent: jest.fn(), buildGrpcAgentsForPlaybook: jest.fn().mockResolvedValue([{}]) } as any,
      { recordUsage: jest.fn() } as any,
    );

    const resultPromise = service.runSingleAgentTask({ userId: 'user-1', agentId: '507f1f77bcf86cd799439011', query: 'Read', attachedFiles: [], correlationId: 'turn-4' });
    setImmediate(() => {
      call.emit('data', { action: 'add', component: { error: { title: 'Exception', content: 'The model could not finish.' } } });
      call.emit('end');
    });

    await expect(resultPromise).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
