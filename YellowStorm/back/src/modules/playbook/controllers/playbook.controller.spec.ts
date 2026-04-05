import { PlaybookController } from './playbook.controller';
import { PlaybookService } from '../services/playbook.service';
import { PlaybookExecutionService } from '../services/playbook-execution.service';
import { PlaybookDesignService } from '../services/playbook-design.service';
import { PlaybookStreamGatewayService } from '../services/playbook-stream-gateway.service';
import { UserService } from '../../user/user.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationType } from '../../notifications/schemas/notification.schema';

describe('PlaybookController', () => {
  let controller: PlaybookController;
  let playbookService: jest.Mocked<
    Pick<
      PlaybookService,
      | 'create'
      | 'findAllByUser'
      | 'findById'
      | 'update'
      | 'delete'
      | 'bulkDelete'
      | 'toggleFavorite'
      | 'getDesignMessages'
      | 'revertToSnapshot'
      | 'cloneForUser'
      | 'getSchedule'
      | 'upsertSchedule'
      | 'clearSchedule'
      | 'getOrCreateIntegrationToken'
    >
  >;
  let executionService: jest.Mocked<
    Pick<
      PlaybookExecutionService,
      'executePlaybook' | 'executePlaybookByIntegrationToken' | 'stopExecution' | 'resumeExecution' | 'findActiveExecutionsByUser'
    >
  >;
  let designService: jest.Mocked<
    Pick<PlaybookDesignService, 'generatePlaybook' | 'designPlaybook'>
  >;
  let streamGateway: jest.Mocked<Pick<PlaybookStreamGatewayService, 'sendToUser'>>;
  let userService: jest.Mocked<Pick<UserService, 'findById' | 'findByEmail'>>;
  let notificationsService: jest.Mocked<Pick<NotificationsService, 'sendToUser'>>;

  const user = { _id: 'user-123', email: 'test@example.com' };
  const playbookId = 'playbook-456';

  beforeEach(() => {
    jest.clearAllMocks();

    playbookService = {
      create: jest.fn().mockResolvedValue({ id: playbookId }),
      findAllByUser: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue({ id: playbookId }),
      update: jest.fn().mockResolvedValue({ id: playbookId }),
      delete: jest.fn().mockResolvedValue(undefined),
      bulkDelete: jest.fn().mockResolvedValue({ deletedCount: 2 }),
      toggleFavorite: jest.fn().mockResolvedValue({ id: playbookId, isFavorite: true }),
      getDesignMessages: jest.fn().mockResolvedValue([]),
      revertToSnapshot: jest.fn().mockResolvedValue({ id: playbookId }),
      cloneForUser: jest.fn().mockResolvedValue({ id: 'cloned-789' }),
      getSchedule: jest.fn().mockResolvedValue(null),
      upsertSchedule: jest.fn().mockResolvedValue({ id: playbookId }),
      clearSchedule: jest.fn().mockResolvedValue({ id: playbookId }),
      getOrCreateIntegrationToken: jest.fn().mockResolvedValue({ token: 'integration-token' }),
    };

    executionService = {
      executePlaybook: jest.fn().mockResolvedValue({ executionId: 'exec-1' }),
      executePlaybookByIntegrationToken: jest.fn().mockResolvedValue({ executionId: 'exec-public-1' }),
      stopExecution: jest.fn().mockResolvedValue(undefined),
      resumeExecution: jest.fn().mockResolvedValue({ executionId: 'exec-1' }),
      findActiveExecutionsByUser: jest.fn().mockResolvedValue([]),
    };

    designService = {
      generatePlaybook: jest.fn().mockResolvedValue({ id: playbookId }),
      designPlaybook: jest.fn().mockResolvedValue({ id: playbookId }),
    };

    streamGateway = {
      sendToUser: jest.fn(),
    };

    userService = {
      findById: jest.fn().mockResolvedValue({
        email: 'test@example.com',
        profile: { firstName: 'Test' },
      }),
      findByEmail: jest.fn(),
    };

    notificationsService = {
      sendToUser: jest.fn().mockResolvedValue(undefined),
    };

    controller = new PlaybookController(
      playbookService as unknown as PlaybookService,
      executionService as unknown as PlaybookExecutionService,
      designService as unknown as PlaybookDesignService,
      {} as any,
      {} as any,
      streamGateway as unknown as PlaybookStreamGatewayService,
      userService as unknown as UserService,
      notificationsService as unknown as NotificationsService,
    );
  });

  describe('create', () => {
    it('should delegate to playbookService.create', async () => {
      const dto = { name: 'My Playbook' } as any;

      await controller.create(user, dto);

      expect(playbookService.create).toHaveBeenCalledWith('user-123', dto);
    });
  });

  describe('findAll', () => {
    it('should delegate to playbookService.findAllByUser', async () => {
      const query = { page: 1, limit: 10 } as any;

      await controller.findAll(user, query);

      expect(playbookService.findAllByUser).toHaveBeenCalledWith('user-123', query);
    });
  });

  describe('findOne', () => {
    it('should delegate to playbookService.findById', async () => {
      await controller.findOne(playbookId);

      expect(playbookService.findById).toHaveBeenCalledWith(playbookId);
    });
  });

  describe('update', () => {
    it('should delegate to playbookService.update', async () => {
      const dto = { name: 'Updated' } as any;

      await controller.update(playbookId, dto);

      expect(playbookService.update).toHaveBeenCalledWith(playbookId, dto);
    });
  });

  describe('delete', () => {
    it('should delegate to playbookService.delete and return deleted flag', async () => {
      const result = await controller.delete(playbookId);

      expect(playbookService.delete).toHaveBeenCalledWith(playbookId);
      expect(result).toEqual({ deleted: true });
    });
  });

  describe('bulkDelete', () => {
    it('should delegate to playbookService.bulkDelete', async () => {
      const ids = ['id-1', 'id-2'];

      await controller.bulkDelete(user, { ids } as any);

      expect(playbookService.bulkDelete).toHaveBeenCalledWith('user-123', ids);
    });
  });

  describe('toggleFavorite', () => {
    it('should delegate to playbookService.toggleFavorite', async () => {
      await controller.toggleFavorite(playbookId);

      expect(playbookService.toggleFavorite).toHaveBeenCalledWith(playbookId);
    });
  });

  describe('generate', () => {
    it('should delegate to designService.generatePlaybook', async () => {
      const dto = { prompt: 'build a flow' } as any;

      await controller.generate(user, dto);

      expect(designService.generatePlaybook).toHaveBeenCalledWith(
        'user-123',
        dto,
        'test@example.com',
      );
    });
  });

  describe('design', () => {
    it('should delegate to designService.designPlaybook', async () => {
      const dto = { message: 'add a node' } as any;

      await controller.design(user, playbookId, dto);

      expect(designService.designPlaybook).toHaveBeenCalledWith(
        'user-123',
        playbookId,
        dto,
        'test@example.com',
      );
    });
  });

  describe('getDesignMessages', () => {
    it('should delegate to playbookService.getDesignMessages', async () => {
      await controller.getDesignMessages(playbookId);

      expect(playbookService.getDesignMessages).toHaveBeenCalledWith(playbookId);
    });
  });

  describe('revertToSnapshot', () => {
    it('should delegate to playbookService.revertToSnapshot', async () => {
      const msgId = 'msg-789';

      await controller.revertToSnapshot(user, playbookId, msgId);

      expect(playbookService.revertToSnapshot).toHaveBeenCalledWith(
        playbookId,
        msgId,
        'user-123',
      );
    });
  });

  describe('execute', () => {
    it('should delegate to executionService.executePlaybook', async () => {
      const dto = { variables: {} } as any;

      await controller.execute(user, playbookId, dto);

      expect(executionService.executePlaybook).toHaveBeenCalledWith(
        'user-123',
        playbookId,
        dto,
        'test@example.com',
        { executionTrigger: 'manual' },
      );
    });
  });

  describe('getIntegrationLink', () => {
    it('should delegate to playbookService.getOrCreateIntegrationToken', async () => {
      const result = await controller.getIntegrationLink(user, playbookId);

      expect(playbookService.getOrCreateIntegrationToken).toHaveBeenCalledWith(playbookId, 'user-123');
      expect(result).toEqual({ token: 'integration-token' });
    });
  });

  describe('executePublic', () => {
    it('should delegate to executionService.executePlaybookByIntegrationToken', async () => {
      const dto = { variables: {} } as any;

      await controller.executePublic('integration-token', dto);

      expect(executionService.executePlaybookByIntegrationToken).toHaveBeenCalledWith('integration-token', dto);
    });
  });

  describe('getSchedule', () => {
    it('should delegate to playbookService.getSchedule', async () => {
      const schedule = { enabled: false, timezone: 'UTC' } as any;
      playbookService.getSchedule.mockResolvedValue(schedule);

      const result = await controller.getSchedule(playbookId);

      expect(playbookService.getSchedule).toHaveBeenCalledWith(playbookId);
      expect(result).toBe(schedule);
    });
  });

  describe('upsertSchedule', () => {
    it('should delegate to playbookService.upsertSchedule', async () => {
      const dto = {
        enabled: true,
        timezone: 'Europe/Paris',
        type: 'daily',
        daily: { timesLocal: ['09:00'] },
      } as any;
      const response = { id: playbookId, executionSchedule: dto };
      playbookService.upsertSchedule.mockResolvedValue(response as any);

      const result = await controller.upsertSchedule(playbookId, dto);

      expect(playbookService.upsertSchedule).toHaveBeenCalledWith(playbookId, dto);
      expect(result).toBe(response);
    });
  });

  describe('clearSchedule', () => {
    it('should delegate to playbookService.clearSchedule', async () => {
      const response = { id: playbookId, executionSchedule: null };
      playbookService.clearSchedule.mockResolvedValue(response as any);

      const result = await controller.clearSchedule(playbookId);

      expect(playbookService.clearSchedule).toHaveBeenCalledWith(playbookId);
      expect(result).toBe(response);
    });
  });

  describe('stop', () => {
    it('should delegate to executionService.stopExecution', async () => {
      const dto = { executionId: 'exec-1' };

      await controller.stop(user, playbookId, dto);

      expect(executionService.stopExecution).toHaveBeenCalledWith(
        'user-123',
        playbookId,
        'exec-1',
        'test@example.com',
      );
    });
  });

  describe('resume', () => {
    it('should delegate to executionService.resumeExecution', async () => {
      const dto = { executionId: 'exec-1', userResponse: 'yes' } as any;

      await controller.resume(user, playbookId, dto);

      expect(executionService.resumeExecution).toHaveBeenCalledWith(
        'user-123',
        playbookId,
        dto,
        'test@example.com',
      );
    });
  });

  describe('getActiveExecutions', () => {
    it('should delegate to executionService.findActiveExecutionsByUser', async () => {
      await controller.getActiveExecutions(user);

      expect(executionService.findActiveExecutionsByUser).toHaveBeenCalledWith('user-123');
    });
  });

  describe('cloneShare', () => {
    it('should clone a playbook for the current user', async () => {
      await controller.clone(user, playbookId);

      expect(playbookService.cloneForUser).toHaveBeenCalledWith(playbookId, 'user-123', { nameSuffix: ' (copy)' });
    });

    it('should clone playbook for each valid target user', async () => {
      const targetUser = { _id: 'target-user-1', email: 'target@example.com' };
      userService.findByEmail.mockResolvedValue(targetUser as any);

      const result = await controller.cloneShare(user, playbookId, {
        emails: ['target@example.com'],
      } as any);

      expect(playbookService.cloneForUser).toHaveBeenCalledWith(playbookId, 'target-user-1');
      expect(result.succeeded).toHaveLength(1);
      expect(result.succeeded[0]).toEqual({ email: 'target@example.com', playbookId: 'cloned-789' });
    });

    it('should report failure when target user is not found', async () => {
      userService.findByEmail.mockResolvedValue(null);

      const result = await controller.cloneShare(user, playbookId, {
        emails: ['nobody@example.com'],
      } as any);

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0]).toEqual({ email: 'nobody@example.com', reason: 'User not found' });
    });

    it('should filter out the current user email', async () => {
      const result = await controller.cloneShare(user, playbookId, {
        emails: ['test@example.com'],
      } as any);

      expect(userService.findByEmail).not.toHaveBeenCalled();
      expect(result.succeeded).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
    });

    it('should deduplicate emails', async () => {
      userService.findByEmail.mockResolvedValue({ _id: 'target-1' } as any);

      await controller.cloneShare(user, playbookId, {
        emails: ['dup@example.com', 'DUP@example.com'],
      } as any);

      expect(userService.findByEmail).toHaveBeenCalledTimes(1);
    });

    it('should send notification and SSE event on successful clone', async () => {
      const targetUser = { _id: 'target-user-1', email: 'target@example.com' };
      userService.findByEmail.mockResolvedValue(targetUser as any);

      await controller.cloneShare(user, playbookId, {
        emails: ['target@example.com'],
      } as any);

      expect(notificationsService.sendToUser).toHaveBeenCalledWith(
        'target-user-1',
        expect.objectContaining({
          type: NotificationType.INFO,
          title: 'Playbook shared with you',
        }),
      );
      expect(streamGateway.sendToUser).toHaveBeenCalledWith(
        'target-user-1',
        expect.objectContaining({ type: 'playbook_shared' }),
      );
    });

    it('should report failure when cloneForUser throws', async () => {
      const targetUser = { _id: 'target-user-1', email: 'target@example.com' };
      userService.findByEmail.mockResolvedValue(targetUser as any);
      playbookService.cloneForUser.mockRejectedValue(new Error('clone failed'));

      const result = await controller.cloneShare(user, playbookId, {
        emails: ['target@example.com'],
      } as any);

      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].reason).toBe('Failed to clone playbook');
    });
  });
});
