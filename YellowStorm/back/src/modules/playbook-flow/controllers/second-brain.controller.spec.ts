import { SecondBrainController } from './second-brain.controller';

describe('SecondBrainController', () => {
  const confirmation = {
    confirmationId: 'confirmation-1',
    conversationId: 'conversation-1',
    continuationCorrelationId: 'second-brain:continuation-1',
    summary: { playbookId: 'playbook-1' },
  };

  it('returns a stored confirmation result without re-entering the runtime', async () => {
    const storedResult = { conversationId: 'conversation-1', answer: 'Execution started', toolResults: [] };
    const secondBrain = { continueConfirmed: jest.fn() };
    const policy = {
      confirm: jest.fn().mockResolvedValue({ kind: 'replayed', result: storedResult }),
      complete: jest.fn(),
      fail: jest.fn(),
    };
    const controller = new SecondBrainController(secondBrain as never, policy as never);

    await expect(controller.confirm('user-1', 'confirmation-1')).resolves.toBe(storedResult);
    expect(secondBrain.continueConfirmed).not.toHaveBeenCalled();
    expect(policy.complete).not.toHaveBeenCalled();
  });

  it('records the continuation result before returning it', async () => {
    const result = { conversationId: 'conversation-1', answer: 'Execution started', toolResults: [] };
    const secondBrain = { continueConfirmed: jest.fn().mockResolvedValue(result) };
    const policy = {
      confirm: jest.fn().mockResolvedValue({ kind: 'claimed', confirmation }),
      complete: jest.fn().mockResolvedValue(undefined),
      fail: jest.fn(),
    };
    const controller = new SecondBrainController(secondBrain as never, policy as never);

    await expect(controller.confirm('user-1', 'confirmation-1')).resolves.toBe(result);
    expect(policy.complete).toHaveBeenCalledWith(
      'user-1',
      'confirmation-1',
      confirmation.continuationCorrelationId,
      result,
    );
    expect(policy.fail).not.toHaveBeenCalled();
  });

  it('does not record a successful model response that made no confirmed tool call', async () => {
    const result = { conversationId: 'conversation-1', answer: 'I did not run it', toolResults: [] };
    const secondBrain = { continueConfirmed: jest.fn().mockResolvedValue(result) };
    const policy = {
      confirm: jest.fn().mockResolvedValue({ kind: 'claimed', confirmation }),
      complete: jest.fn().mockRejectedValue(new Error('confirmation did not reach executing')),
      fail: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new SecondBrainController(secondBrain as never, policy as never);

    await expect(controller.confirm('user-1', 'confirmation-1')).rejects.toThrow('confirmation did not reach executing');
    expect(policy.fail).toHaveBeenCalledWith('user-1', 'confirmation-1');
  });

  it('does not record a continuation that proposes different tool arguments', async () => {
    const result = {
      conversationId: 'conversation-1',
      answer: 'Please confirm the changed action',
      toolResults: [{ result: { pendingAction: { confirmationId: 'different-confirmation' } } }],
    };
    const secondBrain = { continueConfirmed: jest.fn().mockResolvedValue(result) };
    const policy = {
      confirm: jest.fn().mockResolvedValue({ kind: 'claimed', confirmation }),
      complete: jest.fn().mockRejectedValue(new Error('confirmation did not reach executing')),
      fail: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new SecondBrainController(secondBrain as never, policy as never);

    await expect(controller.confirm('user-1', 'confirmation-1')).rejects.toThrow('confirmation did not reach executing');
    expect(policy.fail).toHaveBeenCalledWith('user-1', 'confirmation-1');
  });

  it('marks a consumed confirmation failed when continuation fails', async () => {
    const error = new Error('runtime unavailable');
    const secondBrain = { continueConfirmed: jest.fn().mockRejectedValue(error) };
    const policy = {
      confirm: jest.fn().mockResolvedValue({ kind: 'claimed', confirmation }),
      complete: jest.fn(),
      fail: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new SecondBrainController(secondBrain as never, policy as never);

    await expect(controller.confirm('user-1', 'confirmation-1')).rejects.toBe(error);
    expect(policy.fail).toHaveBeenCalledWith('user-1', 'confirmation-1');
  });
});
