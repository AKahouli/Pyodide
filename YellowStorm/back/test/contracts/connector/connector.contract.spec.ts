import 'reflect-metadata';
import { expectContract } from '../expect-contract';
import { toWire, expectNoMongoKeys, expectNoKeys } from '../wire-helpers';
import { CONNECTOR_ID, connectorRow, makeConnectorService } from './connector-fixtures';

describe('connector response contract', () => {
  it('toResponse matches the fixture and carries no secrets', () => {
    const service = makeConnectorService([]);
    const body = toWire(
      service.toResponse({
        ...connectorRow({ authSourceType: 'connected_app', connectedAppKey: 'microsoft' }),
        categoryName: 'Productivity',
      }),
    );
    expectContract('connector/connector', body);
    expect(body.id).toBe(CONNECTOR_ID);
    expect(body.referencedSkillIds).toEqual(['64b000000000000000000701']);
    expectNoMongoKeys(body);
    expectNoKeys(body, 'clientSecret', 'accessToken', 'refreshToken', 'password', 'apiKey', 'skillIds');
  });
});
