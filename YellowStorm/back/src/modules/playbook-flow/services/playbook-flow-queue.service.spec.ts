import { PlaybookFlowQueueService } from './playbook-flow-queue.service';

describe('PlaybookFlowQueueService', () => {
  const OWNER = 'owner-1';
  const MAX_CONCURRENT = 3;
  const MAX_DEPTH = 50;

  let executions: {
    countQueued: jest.Mock;
    countActive: jest.Mock;
    update: jest.Mock;
    claimNextQueued: jest.Mock;
    renumberQueue: jest.Mock;
    findById: jest.Mock;
  };
  let service: PlaybookFlowQueueService;

  beforeEach(() => {
    executions = {
      countQueued: jest.fn().mockResolvedValue(0),
      countActive: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue(true),
      claimNextQueued: jest.fn().mockResolvedValue(null),
      renumberQueue: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(null),
    };
    service = new PlaybookFlowQueueService(executions as never);
  });

  describe('admit', () => {
    it('sets position to 1 when first in queue', async () => {
      const position = await service.admit(OWNER, 'exec-1', MAX_CONCURRENT, MAX_DEPTH);
      expect(position).toBe(1);
      expect(executions.countQueued).toHaveBeenCalledWith(OWNER, 'exec-1');
      expect(executions.update).toHaveBeenCalledWith('exec-1', { queuePosition: 1 });
    });

    it('sets position after existing queued executions', async () => {
      executions.countQueued.mockResolvedValue(1);
      expect(await service.admit(OWNER, 'exec-queued', MAX_CONCURRENT, MAX_DEPTH)).toBe(2);
      expect(executions.update).toHaveBeenCalledWith('exec-queued', { queuePosition: 2 });
    });

    it('rejects when queue depth exceeded', async () => {
      executions.countQueued.mockResolvedValue(MAX_DEPTH);
      expect(await service.admit(OWNER, 'exec-full', MAX_CONCURRENT, MAX_DEPTH)).toBe(-1);
      expect(executions.update).not.toHaveBeenCalled();
    });
  });

  describe('claimNext', () => {
    it('returns the run the repository claimed atomically under the slot limit', async () => {
      executions.claimNextQueued.mockResolvedValue({ id: 'exec-old', status: 'running' });
      const claimed = await service.claimNext(OWNER, MAX_CONCURRENT);
      expect(claimed?.id).toBe('exec-old');
      expect(executions.claimNextQueued).toHaveBeenCalledWith(OWNER, MAX_CONCURRENT);
    });

    it('returns null when capacity is full or nothing is queued', async () => {
      expect(await service.claimNext(OWNER, MAX_CONCURRENT)).toBeNull();
    });
  });

  describe('refreshPositions', () => {
    it('returns the positions the repository renumbered', async () => {
      executions.renumberQueue.mockResolvedValue([{ executionId: 'q1', queuePosition: 1 }, { executionId: 'q3', queuePosition: 3 }]);
      expect(await service.refreshPositions(OWNER)).toEqual([{ executionId: 'q1', queuePosition: 1 }, { executionId: 'q3', queuePosition: 3 }]);
      expect(executions.renumberQueue).toHaveBeenCalledWith(OWNER);
    });

    it('returns no change when positions already correct', async () => {
      expect(await service.refreshPositions(OWNER)).toEqual([]);
    });
  });

  describe('positions and counts', () => {
    it('reads the queue position, 0 for an unknown execution', async () => {
      executions.findById.mockResolvedValueOnce({ id: 'q1', queuePosition: 4 });
      expect(await service.getQueuePosition(OWNER, 'q1')).toBe(4);
      expect(await service.getQueuePosition(OWNER, 'gone')).toBe(0);
    });

    it('counts running and paused runs as held slots', async () => {
      executions.countActive.mockResolvedValue(2);
      expect(await service.getRunningCount(OWNER)).toBe(2);
    });
  });

  describe('release', () => {
    it('claims next queued execution after release', async () => {
      executions.claimNextQueued.mockResolvedValue({ id: 'queued', status: 'running' });
      const claimed = await service.release(OWNER, MAX_CONCURRENT);
      expect(claimed?.id).toBe('queued');
    });
  });
});
