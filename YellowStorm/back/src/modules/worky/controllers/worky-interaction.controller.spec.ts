import { newObjectId } from '@common/postgres';
import { WorkyInteractionController } from './worky-interaction.controller';

describe('WorkyInteractionController.respond (replan approval end-to-end)', () => {
  const userId = newObjectId();
  const streamId = newObjectId();
  const planDeltaId = newObjectId();
  const user = { _id: { toString: () => userId } };

  const buildController = () => {
    const interactionsService = {
      respond: jest.fn().mockResolvedValue({
        interactionId: newObjectId(),
        streamId,
        status: 'responded',
        response: 'go',
        verdict: 'approved',
        followUpTurnStarted: false,
      }),
    };
    const planDeltaService = {
      applyApproved: jest.fn().mockResolvedValue({
        status: 'auto_applied',
        planDeltaId,
        resultPlanVersion: 5,
        createdTaskIds: [],
        updatedTaskIds: [],
        cancelledTaskIds: [],
      }),
    };
    const preparedTurn = { turnId: 'turn-1' };
    const kickoff = {
      prepare: jest.fn().mockResolvedValue(preparedTurn),
      dispatch: jest.fn().mockReturnValue('turn-1'),
    };
    const streams = {
      findById: jest.fn().mockResolvedValue({ id: streamId, ownerUserId: userId, shares: [] }),
    };
    const interactionRecords = {
      findById: jest.fn().mockResolvedValue({
        id: newObjectId(),
        streamId,
        type: 'replan_review',
        status: 'pending',
        metadata: { planDeltaId },
      }),
    };
    const plans = {
      findDeltaById: jest.fn().mockResolvedValue({
        id: planDeltaId,
        streamId,
        status: 'pending_approval',
        body: {},
      }),
    };
    const controller = new WorkyInteractionController(
      interactionsService as never,
      planDeltaService as never,
      kickoff as never,
      streams as never,
      interactionRecords as never,
      plans as never,
    );
    return { controller, planDeltaService, interactionsService, interactionRecords, streams, plans, kickoff };
  };

  it('applies the pending replan delta when the owner approves a replan_review', async () => {
    const { controller, planDeltaService, kickoff, streams, plans } = buildController();
    const result = await controller.respond(user as never, newObjectId(), { content: 'go', approve: true });
    expect(streams.findById).toHaveBeenCalledWith(streamId);
    expect(plans.findDeltaById).toHaveBeenCalledWith(planDeltaId);
    expect(planDeltaService.applyApproved).toHaveBeenCalledWith({
      planDeltaId,
      approvedBy: userId,
    });
    expect(result.replanApplied).toEqual({
      planDeltaId,
      status: 'auto_applied',
    });
    expect(kickoff.prepare).toHaveBeenCalledWith({
      streamId,
      userId,
      content: 'go',
      requester: user,
    });
    expect(kickoff.dispatch).toHaveBeenCalledWith({ turnId: 'turn-1' });
    expect(result.followUpTurnStarted).toBe(true);
  });

  it('does NOT apply the delta when the owner rejects the replan', async () => {
    const { controller, planDeltaService, interactionsService } = buildController();
    interactionsService.respond.mockResolvedValueOnce({
      interactionId: newObjectId(),
      streamId,
      status: 'responded',
      response: 'no',
      verdict: 'rejected',
      followUpTurnStarted: false,
    });
    const result = await controller.respond(user as never, newObjectId(), { content: 'no', approve: false });
    expect(planDeltaService.applyApproved).not.toHaveBeenCalled();
    expect(result.replanApplied).toBeUndefined();
  });

  it('does NOT apply the delta when the interaction is not a replan_review', async () => {
    const { controller, planDeltaService, interactionRecords } = buildController();
    interactionRecords.findById.mockResolvedValueOnce({
      id: newObjectId(),
      streamId,
      type: 'clarification',
      status: 'pending',
      metadata: {},
    });
    await controller.respond(user as never, newObjectId(), { content: 'reply', approve: true });
    expect(planDeltaService.applyApproved).not.toHaveBeenCalled();
  });

  it('does NOT apply a delta that is no longer pending approval', async () => {
    const { controller, planDeltaService, plans } = buildController();
    plans.findDeltaById.mockResolvedValueOnce({ id: planDeltaId, streamId, status: 'applied', body: {} });
    const result = await controller.respond(user as never, newObjectId(), { content: 'go', approve: true });
    expect(planDeltaService.applyApproved).not.toHaveBeenCalled();
    expect(result.replanApplied).toBeUndefined();
  });

  it('does not consume the interaction when kickoff preflight fails', async () => {
    const { controller, interactionsService, kickoff } = buildController();
    kickoff.prepare.mockRejectedValueOnce(new Error('context unavailable'));

    await expect(
      controller.respond(user as never, newObjectId(), { content: 'go', approve: true }),
    ).rejects.toThrow('context unavailable');

    expect(interactionsService.respond).not.toHaveBeenCalled();
    expect(kickoff.dispatch).not.toHaveBeenCalled();
  });

  it('does not preflight or dispatch a canceled interaction', async () => {
    const { controller, interactionsService, kickoff } = buildController();
    interactionsService.respond.mockResolvedValueOnce({
      interactionId: newObjectId(),
      streamId,
      status: 'canceled',
      response: '',
      verdict: null,
      followUpTurnStarted: false,
    });

    await controller.respond(user as never, newObjectId(), { content: 'cancel', cancel: true });

    expect(kickoff.prepare).not.toHaveBeenCalled();
    expect(kickoff.dispatch).not.toHaveBeenCalled();
  });

  it('answers not found for a malformed or unknown interaction id', async () => {
    const { controller, interactionRecords, interactionsService } = buildController();

    await expect(controller.respond(user as never, 'nope', { content: 'x' })).rejects.toMatchObject({ code: 'ERR_3510' });
    expect(interactionRecords.findById).not.toHaveBeenCalled();

    interactionRecords.findById.mockResolvedValueOnce(null);
    await expect(controller.respond(user as never, newObjectId(), { content: 'x' })).rejects.toMatchObject({ code: 'ERR_3510' });
    expect(interactionsService.respond).not.toHaveBeenCalled();
  });

  it('rejects a user without write access to the stream', async () => {
    const { controller, streams, interactionsService, kickoff } = buildController();
    streams.findById.mockResolvedValueOnce({ id: streamId, ownerUserId: newObjectId(), shares: [] });

    await expect(controller.respond(user as never, newObjectId(), { content: 'x' })).rejects.toMatchObject({ code: 'ERR_3501' });
    expect(kickoff.prepare).not.toHaveBeenCalled();
    expect(interactionsService.respond).not.toHaveBeenCalled();
  });
});
