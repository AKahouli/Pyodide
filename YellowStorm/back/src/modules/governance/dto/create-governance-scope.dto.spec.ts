import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateGovernanceScopeDto } from './create-governance-scope.dto';

describe('CreateGovernanceScopeDto knowledge validation', () => {
  it('accepts a well-formed knowledge payload', async () => {
    const dto = plainToInstance(CreateGovernanceScopeDto, {
      name: 'Scope',
      knowledge: { sourceMode: 'workspaces_only', webSourcesEnabled: true, webAllowedDomains: ['docs.example.com'], webBlockedDomains: [] },
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects malformed nested knowledge payloads', async () => {
    const dto = plainToInstance(CreateGovernanceScopeDto, {
      name: 'Scope',
      knowledge: { sourceMode: 'bogus', webSourcesEnabled: 'yes', webAllowedDomains: 'example.com', webBlockedDomains: [42] },
    });

    const errors = await validate(dto);
    const knowledgeError = errors.find((error) => error.property === 'knowledge');
    expect(knowledgeError).toBeDefined();
    const childProperties = (knowledgeError?.children ?? []).map((child) => child.property);
    expect(childProperties).toEqual(expect.arrayContaining(['sourceMode', 'webSourcesEnabled', 'webAllowedDomains', 'webBlockedDomains']));
  });
});
