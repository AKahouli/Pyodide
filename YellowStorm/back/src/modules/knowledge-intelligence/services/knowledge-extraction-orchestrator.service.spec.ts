import { Types } from 'mongoose';
import { KnowledgeExtractionOrchestratorService } from './knowledge-extraction-orchestrator.service';

describe('KnowledgeExtractionOrchestratorService', () => {
  const input = { programId: new Types.ObjectId().toString(), sourceId: new Types.ObjectId().toString(), sourceVersionId: new Types.ObjectId().toString(), connectorId: new Types.ObjectId().toString(), jobType: 'technical_metadata' as const, inputHash: 'hash-1', engineVersion: 'technical-metadata-v1' };

  it('upserts an idempotent pending job using the version input identity', async () => {
    const job = { id: 'job-1' };
    const model = { findOneAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(job) })) };
    const service = new KnowledgeExtractionOrchestratorService(model as never);

    await expect(service.enqueue(input)).resolves.toBe(job);

    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ jobType: 'technical_metadata', inputHash: 'hash-1', engineVersion: 'technical-metadata-v1' }),
      expect.objectContaining({ $setOnInsert: expect.objectContaining({ status: 'pending', attempts: 0 }) }),
      expect.objectContaining({ upsert: true, new: true }),
    );
  });

  it('records attempts and terminal timestamps when work is updated', async () => {
    const model = { findOneAndUpdate: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ id: 'job-1' }) })), updateMany: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 0 }) })) };
    const service = new KnowledgeExtractionOrchestratorService(model as never);

    await service.markRunning('job-1');
    await service.markFailed('job-1', 'lease-1', 'temporary failure');

    expect(model.findOneAndUpdate).toHaveBeenNthCalledWith(1, { _id: 'job-1', status: { $in: ['pending', 'failed'] } }, expect.objectContaining({ $inc: { attempts: 1 }, $set: expect.objectContaining({ status: 'running' }) }), { new: true });
    expect(model.findOneAndUpdate).toHaveBeenNthCalledWith(2, { _id: 'job-1', status: 'running', leaseToken: 'lease-1' }, expect.objectContaining({ $set: expect.objectContaining({ status: 'failed', error: 'temporary failure', completedAt: expect.any(Date) }) }), { new: true });
  });

  it('returns the persisted job when concurrent creation receives a duplicate key', async () => {
    const job = { id: 'job-1' };
    const model = { findOneAndUpdate: jest.fn(() => ({ exec: jest.fn().mockRejectedValue({ code: 11000 }) })), findOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(job) })) };
    const service = new KnowledgeExtractionOrchestratorService(model as never);

    await expect(service.enqueue(input)).resolves.toBe(job);
    expect(model.findOne).toHaveBeenCalledWith(expect.objectContaining({ jobType: 'technical_metadata', inputHash: 'hash-1' }));
  });
});
