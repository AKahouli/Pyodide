import { Types } from 'mongoose';
import { WorkyInteractionController } from './worky-interaction.controller';

describe('WorkyInteractionController.respond (replan approval end-to-end)', () => {
  const userObjectId = new Types.ObjectId();
  const streamObjectId = new Types.ObjectId();
  const planDeltaId = new Types.ObjectId();

  const buildController = () => {
    const interactionsService = {
      respond: jest.fn().mockResolvedValue({
        interactionId: new Types.ObjectId().toString(),
        streamId: streamObjectId.toString(),
        status: 'responded',
        response: 'go',
        verdict: 'approved',
        followUpTurnStarted: false,
      }),
    };
    const planningService = { startTurn: jest.fn() };
    const planDeltaService = {
      applyApproved: jest.fn().mockResolvedValue({
        status: 'auto_applied',
        planDeltaId: planDeltaId.toString(),
        resultPlanVersion: 5,
        createdTaskIds: [],
        updatedTaskIds: [],
        cancelledTaskIds: [],
      }),
    };
    const streamsModel = {
      findById: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ ownerUserId: userObjectId }),
        }),
      }),
    };
    const interactionModel = {
      findById: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: new Types.ObjectId(),
            streamId: streamObjectId,
            type: 'replan_review',
            status: 'pending',
            metadata: { planDeltaId: planDeltaId.toString() },
          }),
        }),
      }),
    };
    const planDeltasModel = {
      findById: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            _id: planDeltaId,
            streamId: streamObjectId,
            status: 'pending_approval',
            body: {},
          }),
        }),
      }),
    };
    const controller = new WorkyInteractionController(
      interactionsService as any,
      planningService as any,
      planDeltaService as any,
      streamsModel as any,
      interactionModel as any,
      planDeltasModel as any,
    );
    return { controller, planDeltaService, interactionsService, planningService, interactionModel };
  };

  it('applies the pending replan delta when the owner approves a replan_review', async () => {
    const { controller, planDeltaService, planningService } = buildController();
    const result = await controller.respond(
      { _id: userObjectId } as any,
      new Types.ObjectId().toString(),
      { content: 'go', approve: true },
    );
    expect(planDeltaService.applyApproved).toHaveBeenCalledWith({
      planDeltaId: planDeltaId.toString(),
      approvedBy: userObjectId.toString(),
    });
    expect(result.replanApplied).toEqual({
      planDeltaId: planDeltaId.toString(),
      status: 'auto_applied',
    });
  });

  it('does NOT apply the delta when the owner rejects the replan', async () => {
    const { controller, planDeltaService, interactionsService } = buildController();
    interactionsService.respond.mockResolvedValueOnce({
      interactionId: new Types.ObjectId().toString(),
      streamId: streamObjectId.toString(),
      status: 'responded',
      response: 'no',
      verdict: 'rejected',
      followUpTurnStarted: false,
    });
    const result = await controller.respond(
      { _id: userObjectId } as any,
      new Types.ObjectId().toString(),
      { content: 'no', approve: false },
    );
    expect(planDeltaService.applyApproved).not.toHaveBeenCalled();
    expect(result.replanApplied).toBeUndefined();
  });

  it('does NOT apply the delta when the interaction is not a replan_review', async () => {
    const { controller, planDeltaService, interactionModel } = buildController();
    interactionModel.findById.mockReturnValueOnce({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(),
          streamId: streamObjectId,
          type: 'clarification',
          status: 'pending',
          metadata: {},
        }),
      }),
    });
    await controller.respond(
      { _id: userObjectId } as any,
      new Types.ObjectId().toString(),
      { content: 'reply', approve: true },
    );
    expect(planDeltaService.applyApproved).not.toHaveBeenCalled();
  });
});
