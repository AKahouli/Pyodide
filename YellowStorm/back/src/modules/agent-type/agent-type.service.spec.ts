import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { AgentTypeService } from './agent-type.service';
import { AgentType } from './schemas/agent-type.schema';
import { AgentTypePrompt } from './schemas/agent-type-prompt.schema';
import { SkillService } from '../skill/skill.service';
import { LoggerService } from '../logger';

function loggerStub() {
  return { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

describe('AgentTypeService.getManyForHydration', () => {
  it('returns a map of id -> {id,name,slug,skills} for the requested ids', async () => {
    const t1 = new Types.ObjectId(); const s1 = new Types.ObjectId();
    const docs = [{ _id: t1, name: 'Mono', slug: 'mono-agent', skills: [s1] }];
    const agentTypeModel = {
      find: jest.fn().mockReturnValue({ select: () => ({ lean: () => ({ exec: () => Promise.resolve(docs) }) }) }),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentTypeService,
        { provide: getModelToken(AgentType.name), useValue: agentTypeModel },
        { provide: getModelToken(AgentTypePrompt.name), useValue: {} },
        { provide: SkillService, useValue: {} },
        { provide: LoggerService, useValue: loggerStub() },
      ],
    }).compile();
    const service = moduleRef.get(AgentTypeService);

    const map = await service.getManyForHydration([t1.toString()]);
    expect(map.get(t1.toString())).toEqual({ id: t1.toString(), name: 'Mono', slug: 'mono-agent', skills: [s1.toString()] });
  });

  it('returns an empty map for empty input without querying', async () => {
    const agentTypeModel = { find: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentTypeService,
        { provide: getModelToken(AgentType.name), useValue: agentTypeModel },
        { provide: getModelToken(AgentTypePrompt.name), useValue: {} },
        { provide: SkillService, useValue: {} },
        { provide: LoggerService, useValue: loggerStub() },
      ],
    }).compile();
    const service = moduleRef.get(AgentTypeService);
    expect((await service.getManyForHydration([])).size).toBe(0);
    expect(agentTypeModel.find).not.toHaveBeenCalled();
  });
});

describe('AgentTypeService.findOrCreateBySlug', () => {
  it('uses an atomic create-only upsert and returns the canonical type', async () => {
    const typeId = new Types.ObjectId();
    const agentType = {
      _id: typeId,
      name: 'Platform Copilot',
      slug: 'platform_copilot',
      defaultPrompt: 'existing prompt',
      skills: [],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const exec = jest.fn().mockResolvedValue(agentType);
    const lean = jest.fn().mockReturnValue({ exec });
    const findOneAndUpdate = jest.fn().mockReturnValue({ lean });
    const countDocuments = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(0) });
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentTypeService,
        { provide: getModelToken(AgentType.name), useValue: { findOneAndUpdate } },
        { provide: getModelToken(AgentTypePrompt.name), useValue: { countDocuments } },
        { provide: SkillService, useValue: {} },
        { provide: LoggerService, useValue: loggerStub() },
      ],
    }).compile();

    const result = await moduleRef.get(AgentTypeService).findOrCreateBySlug('platform_copilot', {
      name: 'Platform Copilot',
      defaultPrompt: '',
      isActive: true,
    });

    expect(result.id).toBe(typeId.toString());
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { slug: 'platform_copilot' },
      { $setOnInsert: expect.objectContaining({ slug: 'platform_copilot', name: 'Platform Copilot' }) },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  });
});
