import { Types } from 'mongoose';
import { HumainAgentService } from './humain-agent.service';

describe('HumainAgentService', () => {
  const humainTypeId = new Types.ObjectId();
  const userId = new Types.ObjectId().toString();

  const makeLogger = () => ({ setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() });

  const makeAgentTypeModel = (humainType: unknown) => ({
    findOne: jest.fn().mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue(humainType) }) }),
  });

  // agentModel.findOne(...).exec() resolves `existing`; create + save are jest fns.
  const makeAgentModel = (existing: unknown) => ({
    findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(existing) }),
    create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
  });

  it('creates a human agent when none exists, keyed by createdBy + agentType, with a placeholder role when profile role is empty', async () => {
    const agentModel = makeAgentModel(null);
    const service = new HumainAgentService(agentModel as never, makeAgentTypeModel({ _id: humainTypeId }) as never, makeLogger() as never);

    await service.ensureForUser({ userId, email: 'jane.doe@acme.io', firstName: 'Jane', lastName: 'Doe' });

    expect(agentModel.create).toHaveBeenCalledTimes(1);
    expect(agentModel.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Jane Doe',
      slug: 'jane-doe',
      role: 'You are Jane Doe, a human agent.',
      description: '',
      createdBy: new Types.ObjectId(userId),
      agentType: humainTypeId,
    }));
  });

  it('falls back to the email local-part for the name when no profile name exists', async () => {
    const agentModel = makeAgentModel(null);
    const service = new HumainAgentService(agentModel as never, makeAgentTypeModel({ _id: humainTypeId }) as never, makeLogger() as never);

    await service.ensureForUser({ userId, email: 'solo@acme.io' });

    expect(agentModel.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'solo', slug: 'solo' }));
  });

  it('ensureForUser is a no-op when the agent already exists (does not create or modify)', async () => {
    const existing = { name: 'Old', slug: 'old', role: 'r', description: 'd', save: jest.fn() };
    const agentModel = makeAgentModel(existing);
    const service = new HumainAgentService(agentModel as never, makeAgentTypeModel({ _id: humainTypeId }) as never, makeLogger() as never);

    await service.ensureForUser({ userId, email: 'jane@acme.io', firstName: 'Jane', lastName: 'Doe', role: 'PM' });

    expect(agentModel.create).not.toHaveBeenCalled();
    expect(existing.save).not.toHaveBeenCalled();
  });

  it('syncFromProfile overwrites name/role/description on the existing agent via save', async () => {
    const existing = { name: 'Old', slug: 'old', role: 'old-role', description: 'old', save: jest.fn().mockResolvedValue(undefined) };
    const agentModel = makeAgentModel(existing);
    const service = new HumainAgentService(agentModel as never, makeAgentTypeModel({ _id: humainTypeId }) as never, makeLogger() as never);

    await service.syncFromProfile({ userId, email: 'jane@acme.io', firstName: 'Jane', lastName: 'Doe', role: 'Product Manager', description: 'Leads discovery' });

    expect(existing.name).toBe('Jane Doe');
    expect(existing.slug).toBe('jane-doe');
    expect(existing.role).toBe('Product Manager');
    expect(existing.description).toBe('Leads discovery');
    expect(existing.save).toHaveBeenCalledTimes(1);
    expect(agentModel.create).not.toHaveBeenCalled();
  });

  it('syncFromProfile creates the agent when none exists yet', async () => {
    const agentModel = makeAgentModel(null);
    const service = new HumainAgentService(agentModel as never, makeAgentTypeModel({ _id: humainTypeId }) as never, makeLogger() as never);

    await service.syncFromProfile({ userId, email: 'jane@acme.io', firstName: 'Jane', lastName: 'Doe', role: 'PM', description: 'bio' });

    expect(agentModel.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Jane Doe', role: 'PM', description: 'bio' }));
  });

  it('no-ops (does not touch the agent model) and warns when the humain type is missing', async () => {
    const agentModel = makeAgentModel(null);
    const logger = makeLogger();
    const service = new HumainAgentService(agentModel as never, makeAgentTypeModel(null) as never, logger as never);

    await service.ensureForUser({ userId, email: 'jane@acme.io' });

    expect(agentModel.findOne).not.toHaveBeenCalled();
    expect(agentModel.create).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('never throws when the agent model rejects — logs a warning instead', async () => {
    const agentModel = {
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      create: jest.fn().mockRejectedValue(new Error('E11000 duplicate key')),
    };
    const logger = makeLogger();
    const service = new HumainAgentService(agentModel as never, makeAgentTypeModel({ _id: humainTypeId }) as never, logger as never);

    await expect(service.ensureForUser({ userId, email: 'jane@acme.io' })).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
