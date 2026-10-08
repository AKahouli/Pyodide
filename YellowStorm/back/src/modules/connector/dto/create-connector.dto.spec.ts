import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConnectorActionDto, CreateConnectorDto } from './create-connector.dto';
import { UpdateConnectorDto } from './update-connector.dto';

describe('Connector hidden visibility DTO', () => {
  it.each([CreateConnectorDto, UpdateConnectorDto])('accepts a boolean isHidden value for %p', async (Dto) => {
    const errors = await validate(plainToInstance(Dto, { isHidden: true }));

    expect(errors.find((error) => error.property === 'isHidden')).toBeUndefined();
  });

  it.each([CreateConnectorDto, UpdateConnectorDto])('rejects a non-boolean isHidden value for %p', async (Dto) => {
    const errors = await validate(plainToInstance(Dto, { isHidden: 'true' }));

    expect(errors.find((error) => error.property === 'isHidden')).toBeDefined();
  });
});

describe('ConnectorActionDto web citation semantics', () => {
  it('rejects malformed worker settings at the REST boundary', async () => {
    const errors = await validate(plainToInstance(UpdateConnectorDto, {
      workerPolicy: { enabled: 'false', defaultExecutionKind: 'automatic', agentLaunchEnabled: false },
      actions: [{ key: 'search', label: 'Search', workerAccess: 'any' }],
    }));
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining(['workerPolicy', 'actions']));
  });
  it('accepts configured web search semantics', async () => {
    const errors = await validate(plainToInstance(ConnectorActionDto, {
      key: 'search', label: 'Search', resultKind: 'web_search', citationMode: 'text_fragment',
      resultMapping: { itemsPath: 'results', fields: { url: ['href'] } },
    }));
    expect(errors).toEqual([]);
  });

  it('rejects unknown result and citation modes', async () => {
    const errors = await validate(plainToInstance(ConnectorActionDto, {
      key: 'search', label: 'Search', resultKind: 'website', citationMode: 'trusted',
    }));
    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining(['resultKind', 'citationMode']));
  });
});
