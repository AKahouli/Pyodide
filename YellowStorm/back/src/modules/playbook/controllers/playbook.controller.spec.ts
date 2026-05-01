import { PlaybookController } from './playbook.controller';
import { PlaybookService } from '../services/playbook.service';
import { PlaybookExecutionService } from '../services/playbook-execution.service';
import { PlaybookDesignService } from '../services/playbook-design.service';
import { PlaybookEvaluationService } from '../services/playbook-evaluation.service';
import { PlaybookStreamGatewayService } from '../services/playbook-stream-gateway.service';
import { UserService } from '../../user/user.service';
import { NotificationsService } from '../../notifications/notifications.service';

describe('PlaybookController', () => {
  let controller: PlaybookController;
  const playbookService = {
    create: jest.fn().mockResolvedValue({ id: 'playbook-456' }),
    findAllByUser: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue({ id: 'playbook-456', triggers: [] }),
    update: jest.fn().mockResolvedValue({ id: 'playbook-456' }),
    delete: jest.fn().mockResolvedValue(undefined),
    bulkDelete: jest.fn().mockResolvedValue({ deletedCount: 2 }),
    toggleFavorite: jest.fn().mockResolvedValue({ id: 'playbook-456', isFavorite: true }),
    getDesignMessages: jest.fn().mockResolvedValue([]),
    revertToSnapshot: jest.fn().mockResolvedValue({ id: 'playbook-456' }),
    cloneForUser: jest.fn().mockResolvedValue({ id: 'cloned-789' }),
    getSchedule: jest.fn().mockResolvedValue(null),
    getTriggers: jest.fn().mockResolvedValue({ automatedTriggerType: null, triggers: [] }),
    upsertSchedule: jest.fn().mockResolvedValue({ id: 'playbook-456' }),
    clearSchedule: jest.fn().mockResolvedValue({ id: 'playbook-456' }),
    clearMailTrigger: jest.fn().mockResolvedValue({ id: 'playbook-456' }),
    syncMailTriggerSubscription: jest.fn().mockResolvedValue({ id: 'playbook-456' }),
    getOrCreateIntegrationToken: jest.fn().mockResolvedValue({ token: 'integration-token' }),
  };
  const executionService = {
    executePlaybook: jest.fn(),
    executePlaybookByIntegrationToken: jest.fn(),
    stopExecution: jest.fn(),
    resumeExecution: jest.fn(),
    findActiveExecutionsByUser: jest.fn(),
  };
  const designService = {
    generatePlaybook: jest.fn(),
    designPlaybook: jest.fn(),
  };
  const evaluationService = {
    listEvaluationExecutions: jest.fn(),
    getActiveBaseline: jest.fn(),
    replaceBaselineFromExecution: jest.fn(),
    replaceBaselineFromCurrentEvaluationExecution: jest.fn(),
    removeActiveBaseline: jest.fn(),
  };
  const playbookIntentService = {
    analyze: jest.fn().mockResolvedValue({ suggestions: [] }),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new PlaybookController(
      playbookService as unknown as PlaybookService,
      executionService as unknown as PlaybookExecutionService,
      designService as unknown as PlaybookDesignService,
      {} as any,
      {} as any,
      {} as any,
      evaluationService as unknown as PlaybookEvaluationService,
      {} as any,
      playbookIntentService as any,
      {} as any,
      {} as any,
      {} as unknown as PlaybookStreamGatewayService,
      {} as unknown as UserService,
      {} as unknown as NotificationsService,
    );
  });

  it('delegates intent analysis to the intent service', async () => {
    const dto = { intent: 'Add review step', selectedTaskId: 'task-1' };

    await controller.analyzeIntent('playbook-456', dto);

    expect(playbookIntentService.analyze).toHaveBeenCalledWith('playbook-456', dto);
  });
});
