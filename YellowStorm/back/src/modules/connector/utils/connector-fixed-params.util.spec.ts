import {
  connectorActionContractsEqual,
  filterConnectorFixedParams,
  getAllowedFixedParamKeys,
} from './connector-fixed-params.util';

describe('connector fixed params utilities', () => {
  it('keeps only declared fixed parameters for finite connector schemas', () => {
    const result = filterConnectorFixedParams(
      { keep: 'value', removed: 'stale' },
      [{
        key: 'search',
        parameterSchema: {
          type: 'object',
          properties: { keep: { type: 'string' } },
          additionalProperties: false,
        },
      }],
    );

    expect(result).toEqual({ keep: 'value' });
  });

  it('preserves undeclared fixed parameters for explicitly open schemas', () => {
    const fixedParams = { keep: 'value', dynamic: 'allowed' };

    expect(filterConnectorFixedParams(fixedParams, [{
      key: 'search',
      parameterSchema: {
        type: 'object',
        properties: { keep: { type: 'string' } },
        additionalProperties: true,
      },
    }])).toBe(fixedParams);
  });

  it('preserves undeclared fixed parameters when additionalProperties is omitted', () => {
    const fixedParams = { keep: 'value', dynamic: 'allowed' };

    expect(filterConnectorFixedParams(fixedParams, [{
      key: 'search',
      parameterSchema: { type: 'object', properties: { keep: { type: 'string' } } },
    }])).toBe(fixedParams);
  });

  it('keeps only keys accepted by every selected action', () => {
    expect(getAllowedFixedParamKeys([
      {
        key: 'one',
        parameterSchema: {
          properties: { shared: {}, firstOnly: {} },
          additionalProperties: false,
        },
      },
      {
        key: 'two',
        parameterSchema: {
          properties: { shared: {}, secondOnly: {} },
          additionalProperties: false,
        },
      },
    ])).toEqual(['shared']);
  });

  it('detects same-key parameter schema changes independent of property order', () => {
    expect(connectorActionContractsEqual(
      [{ key: 'search', parameterSchema: { properties: { a: {}, b: {} } } }],
      [{ key: 'search', parameterSchema: { properties: { b: {}, a: {} } } }],
    )).toBe(true);
    expect(connectorActionContractsEqual(
      [{ key: 'search', parameterSchema: { properties: { oldArg: {} } } }],
      [{ key: 'search', parameterSchema: { properties: { newArg: {} } } }],
    )).toBe(false);
  });
});
