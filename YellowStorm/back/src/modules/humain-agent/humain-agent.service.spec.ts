import { Types } from 'mongoose';
import { HumainAgentService } from './humain-agent.service';

describe('HumainAgentService', () => {
  const humainTypeId = new Types.ObjectId();
  const userId = new Types.ObjectId().toString();

  const makeLogger = () => ({ setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() });

  const makeAgentTypeModel = (humainType: unknown) => ({
    findOne: jest.fn().mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue(humainType) }) }),
  });

  const makeAgentModel = () => ({
    findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }) }),
  });

  it('creates a human agent on ensureForUser, keyed by createdBy + agentType, with a placeholder role when profile role is empty', async () => {
    const agentTypeModel = makeAgentTypeModel({ _id: humainTypeId });
    const agentModel = makeAgentModel();
    const service = new HumainAgentService(agentModel as never, agentTypeModel as never, makeLogger() as never);

    await service.ensureForUser({ userId, email: 'jane.doe@acme.io', firstName: 'Jane', lastName: 'Doe' });

    expect(agentModel.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, update, options] = agentModel.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ createdBy: new Types.ObjectId(userId), agentType: humainTypeId });
    expect(update.$setOnInsert).toEqual(expect.objectContaining({
      name: 'Jane Doe',
      slug: 'jane-doe',
      role: 'You are Jane Doe, a human agent.',
      description: '',
    }));
    expect(update.$set).toBeUndefined();
    expect(options).toEqual({ upsert: true, new: true, setDefaultsOnInsert: true });
  });

  it('falls back to the email local-part for the name when no profile name exists', async () => {
    const agentModel = makeAgentModel();
    const service = new HumainAgentService(agentModel as never, makeAgentTypeModel({ _id: humainTypeId }) as never, makeLogger() as never);

    await service.ensureForUser({ userId, email: 'solo@acme.io' });

    const update = agentModel.findOneAndUpdate.mock.calls[0][1];
    expect(update.$setOnInsert.name).toBe('solo');
    expect(update.$setOnInsert.slug).toBe('solo');
  });

  it('overwrites name/role/description on syncFromProfile via $set', async () => {
    const agentModel = makeAgentModel();
    const service = new HumainAgentService(agentModel as never, makeAgentTypeModel({ _id: humainTypeId }) as never, makeLogger() as never);

    await service.syncFromProfile({ userId, email: 'jane@acme.io', firstName: 'Jane', lastName: 'Doe', role: 'Product Manager', description: 'Leads discovery' });

    const update = agentModel.findOneAndUpdate.mock.calls[0][1];
    expect(update.$set).toEqual({ name: 'Jane Doe', slug: 'jane-doe', role: 'Product Manager', description: 'Leads discovery' });
    expect(update.$setOnInsert).toEqual({ createdBy: new Types.ObjectId(userId), agentType: humainTypeId });
  });

  it('no-ops (does not touch the agent model) and warns when the humain type is missing', async () => {
    const agentModel = makeAgentModel();
    const logger = makeLogger();
    const service = new HumainAgentService(agentModel as never, makeAgentTypeModel(null) as never, logger as never);

    await service.ensureForUser({ userId, email: 'jane@acme.io' });

    expect(agentModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('never throws when the agent model rejects — logs a warning instead', async () => {
    const agentModel = { findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockRejectedValue(new Error('E11000 duplicate key')) }) };
    const logger = makeLogger();
    const service = new HumainAgentService(agentModel as never, makeAgentTypeModel({ _id: humainTypeId }) as never, logger as never);

    await expect(service.ensureForUser({ userId, email: 'jane@acme.io' })).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
