import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AgentTypeService } from './agent-type.service';
import { AGENT_TYPE_STORE, type AgentTypeRow, type AgentTypeStore } from './persistence/agent-type.store';
import { SkillService } from '../skill/skill.service';
import { LoggerService } from '../logger';

function loggerStub() {
  return { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
}

describe('AgentTypeService.getManyForHydration', () => {
  it('returns a map of id -> {id,name,slug,skills} for the requested ids', async () => {
    const t1 = new Types.ObjectId().toString(); const s1 = new Types.ObjectId().toString();
    const store = {
      findByIds: jest.fn().mockResolvedValue([{ id: t1, name: 'Mono', slug: 'mono-agent', skills: [s1] }]),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentTypeService,
        { provide: AGENT_TYPE_STORE, useValue: store },
        { provide: SkillService, useValue: {} },
        { provide: LoggerService, useValue: loggerStub() },
      ],
    }).compile();
    const service = moduleRef.get(AgentTypeService);

    const map = await service.getManyForHydration([t1]);
    expect(map.get(t1)).toEqual({ id: t1, name: 'Mono', slug: 'mono-agent', skills: [s1] });
  });

  it('returns an empty map for empty input without querying', async () => {
    const store = { findByIds: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentTypeService,
        { provide: AGENT_TYPE_STORE, useValue: store },
        { provide: SkillService, useValue: {} },
        { provide: LoggerService, useValue: loggerStub() },
      ],
    }).compile();
    const service = moduleRef.get(AgentTypeService);
    expect((await service.getManyForHydration([])).size).toBe(0);
    expect(store.findByIds).not.toHaveBeenCalled();
  });
});

describe('AgentTypeService.findOrCreateBySlug', () => {
  it('uses an atomic create-only upsert and returns the canonical type', async () => {
    const typeId = new Types.ObjectId().toString();
    const row: AgentTypeRow = {
      id: typeId,
      name: 'Platform Copilot',
      slug: 'platform_copilot',
      defaultPrompt: 'existing prompt',
      skills: [],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const store = {
      findOrCreateBySlug: jest.fn().mockResolvedValue(row),
      promptCount: jest.fn().mockResolvedValue(0),
    } as unknown as AgentTypeStore;
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentTypeService,
        { provide: AGENT_TYPE_STORE, useValue: store },
        { provide: SkillService, useValue: {} },
        { provide: LoggerService, useValue: loggerStub() },
      ],
    }).compile();

    const result = await moduleRef.get(AgentTypeService).findOrCreateBySlug('platform_copilot', {
      name: 'Platform Copilot',
      defaultPrompt: '',
      isActive: true,
    });

    expect(result.id).toBe(typeId);
    expect(store.findOrCreateBySlug).toHaveBeenCalledWith(
      'platform_copilot',
      expect.objectContaining({ name: 'Platform Copilot' }),
    );
  });
});
