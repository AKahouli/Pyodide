import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAgentDto } from './create-agent.dto';
import { UpdateAgentDto } from './update-agent.dto';

const baseCreate = { name: 'Agent', slug: 'agent', agentType: '507f1f77bcf86cd799439011', role: 'Role' };

describe('genUiEnabled validation', () => {
  it('is optional on create and update', async () => {
    expect(await validate(plainToInstance(CreateAgentDto, baseCreate))).toEqual([]);
    expect(await validate(plainToInstance(UpdateAgentDto, {}))).toEqual([]);
  });

  it('accepts booleans on create and update', async () => {
    expect(await validate(plainToInstance(CreateAgentDto, { ...baseCreate, genUiEnabled: false }))).toEqual([]);
    expect(await validate(plainToInstance(UpdateAgentDto, { genUiEnabled: true }))).toEqual([]);
  });

  it('rejects non-boolean values', async () => {
    const create = await validate(plainToInstance(CreateAgentDto, { ...baseCreate, genUiEnabled: 'yes' }));
    const update = await validate(plainToInstance(UpdateAgentDto, { genUiEnabled: 1 }));

    expect(create.map((error) => error.property)).toContain('genUiEnabled');
    expect(update.map((error) => error.property)).toContain('genUiEnabled');
  });
});
