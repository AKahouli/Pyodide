import { Types } from 'mongoose';
import { HumainAgentService } from './humain-agent.service';

describe('HumainAgentService', () => {
  const humainTypeId = new Types.ObjectId();
  const userId = new Types.ObjectId().toString();

  const makeLogger = () => ({ setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() });

  const makeAgentTypeModel = (humainType: unknown) => ({
    findOne: jest.fn().mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue(humainType) }) }),
  });

  // agentRepository.findByOwnerAndType resolves `existing`; create + updateById are jest fns.
  const makeAgentRepository = (existing: unknown) => ({
    findByOwnerAndType: jest.fn().mockResolvedValue(existing),
    create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId().toString() }),
    updateById: jest.fn().mockResolvedValue({ _id: new Types.ObjectId().toString() }),
  });

  it('creates a human agent when none exists, keyed by createdBy + agentType, with a placeholder role when profile role is empty', async () => {
    const agentRepository = makeAgentRepository(null);
    const service = new HumainAgentService(agentRepository as never, makeAgentTypeModel({ _id: humainTypeId, slug: 'humain' }) as never, makeLogger() as never);

    await service.ensureForUser({ userId, email: 'jane.doe@acme.io', firstName: 'Jane', lastName: 'Doe' });

    expect(agentRepository.create).toHaveBeenCalledTimes(1);
    expect(agentRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Jane Doe',
      slug: 'jane-doe',
      role: 'You are Jane Doe, a human agent.',
      description: '',
      createdBy: userId,
      agentType: String(humainTypeId),
    }));
  });

  it('falls back to the email local-part for the name when no profile name exists', async () => {
    const agentRepository = makeAgentRepository(null);
    const service = new HumainAgentService(agentRepository as never, makeAgentTypeModel({ _id: humainTypeId, slug: 'humain' }) as never, makeLogger() as never);

    await service.ensureForUser({ userId, email: 'solo@acme.io' });

    expect(agentRepository.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'solo', slug: 'solo' }));
  });

  it('ensureForUser is a no-op when the agent already exists (does not create or modify)', async () => {
    const existing = { _id: new Types.ObjectId().toString(), name: 'Old', slug: 'old', role: 'r', description: 'd' };
    const agentRepository = makeAgentRepository(existing);
    const service = new HumainAgentService(agentRepository as never, makeAgentTypeModel({ _id: humainTypeId, slug: 'humain' }) as never, makeLogger() as never);

    await service.ensureForUser({ userId, email: 'jane@acme.io', firstName: 'Jane', lastName: 'Doe', role: 'PM' });

    expect(agentRepository.create).not.toHaveBeenCalled();
    expect(agentRepository.updateById).not.toHaveBeenCalled();
  });

  it('syncFromProfile overwrites name/role/description on the existing agent via updateById', async () => {
    const existing = { _id: new Types.ObjectId().toString(), name: 'Old', slug: 'old', role: 'old-role', description: 'old' };
    const agentRepository = makeAgentRepository(existing);
    const service = new HumainAgentService(agentRepository as never, makeAgentTypeModel({ _id: humainTypeId, slug: 'humain' }) as never, makeLogger() as never);

    await service.syncFromProfile({ userId, email: 'jane@acme.io', firstName: 'Jane', lastName: 'Doe', role: 'Product Manager', description: 'Leads discovery' });

    expect(agentRepository.updateById).toHaveBeenCalledWith(existing._id, expect.objectContaining({
      name: 'Jane Doe',
      slug: 'jane-doe',
      role: 'Product Manager',
      description: 'Leads discovery',
    }));
    expect(agentRepository.create).not.toHaveBeenCalled();
  });

  it('syncFromProfile creates the agent when none exists yet', async () => {
    const agentRepository = makeAgentRepository(null);
    const service = new HumainAgentService(agentRepository as never, makeAgentTypeModel({ _id: humainTypeId, slug: 'humain' }) as never, makeLogger() as never);

    await service.syncFromProfile({ userId, email: 'jane@acme.io', firstName: 'Jane', lastName: 'Doe', role: 'PM', description: 'bio' });

    expect(agentRepository.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Jane Doe', role: 'PM', description: 'bio' }));
  });

  it('no-ops (does not touch the agent repository) and warns when the humain type is missing', async () => {
    const agentRepository = makeAgentRepository(null);
    const logger = makeLogger();
    const service = new HumainAgentService(agentRepository as never, makeAgentTypeModel(null) as never, logger as never);

    await service.ensureForUser({ userId, email: 'jane@acme.io' });

    expect(agentRepository.findByOwnerAndType).not.toHaveBeenCalled();
    expect(agentRepository.create).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('never throws when the agent repository rejects — logs a warning instead', async () => {
    const agentRepository = {
      findByOwnerAndType: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockRejectedValue(new Error('E11000 duplicate key')),
      updateById: jest.fn(),
    };
    const logger = makeLogger();
    const service = new HumainAgentService(agentRepository as never, makeAgentTypeModel({ _id: humainTypeId, slug: 'humain' }) as never, logger as never);

    await expect(service.ensureForUser({ userId, email: 'jane@acme.io' })).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
