import { PlaybookExecutionController } from './playbook-execution.controller';
import { PlaybookService } from '../services/playbook.service';

describe('PlaybookExecutionController', () => {
  let controller: PlaybookExecutionController;
  let playbookService: jest.Mocked<
    Pick<PlaybookService, 'findExecutionsByPlaybook' | 'findExecutionById'>
  >;

  const playbookId = 'playbook-123';

  beforeEach(() => {
    jest.clearAllMocks();

    playbookService = {
      findExecutionsByPlaybook: jest.fn().mockResolvedValue([]),
      findExecutionById: jest.fn().mockResolvedValue({ id: 'exec-1' }),
    };

    controller = new PlaybookExecutionController(
      playbookService as unknown as PlaybookService,
    );
  });

  describe('listExecutions', () => {
    it('should delegate to playbookService.findExecutionsByPlaybook', async () => {
      const query = { page: 1, limit: 20 } as any;

      await controller.listExecutions(playbookId, query);

      expect(playbookService.findExecutionsByPlaybook).toHaveBeenCalledWith(playbookId, query);
    });

    it('should return the service result', async () => {
      const executions = [{ id: 'exec-1' }, { id: 'exec-2' }];
      playbookService.findExecutionsByPlaybook.mockResolvedValue(executions as any);

      const result = await controller.listExecutions(playbookId, {} as any);

      expect(result).toEqual(executions);
    });
  });

  describe('getExecution', () => {
    it('should delegate to playbookService.findExecutionById', async () => {
      const execId = 'exec-789';

      await controller.getExecution(playbookId, execId);

      expect(playbookService.findExecutionById).toHaveBeenCalledWith(playbookId, execId);
    });

    it('should return the service result', async () => {
      const execution = { id: 'exec-1', status: 'completed' };
      playbookService.findExecutionById.mockResolvedValue(execution as any);

      const result = await controller.getExecution(playbookId, 'exec-1');

      expect(result).toEqual(execution);
    });
  });
});
