import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateAgentTypeDto } from './create-agent-type.dto';
import { UpdateAgentTypeDto } from './update-agent-type.dto';

describe('agent type name validation', () => {
  it.each([CreateAgentTypeDto, UpdateAgentTypeDto])('accepts hyphenated names for %p', async (Dto) => {
    const dto = plainToInstance(Dto, { name: 'mono-agent' });

    expect(await validate(dto)).toHaveLength(0);
  });

  it.each([CreateAgentTypeDto, UpdateAgentTypeDto])('rejects other punctuation for %p', async (Dto) => {
    const dto = plainToInstance(Dto, { name: 'mono_agent' });

    expect(await validate(dto)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        property: 'name',
        constraints: expect.objectContaining({
          matches: 'Name must contain only letters, numbers, spaces, and hyphens',
        }),
      }),
    ]));
  });
});
