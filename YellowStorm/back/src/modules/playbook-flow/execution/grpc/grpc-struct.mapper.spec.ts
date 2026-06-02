import { buildGrpcHumanApprovalConfig, fromGrpcValue, toGrpcStruct } from './grpc-struct.mapper';

describe('grpc-struct.mapper', () => {
  it('maps nested JSON into proto-loader Struct values', () => {
    expect(toGrpcStruct({
      text: 'hello',
      count: 2,
      enabled: true,
      empty: null,
      list: ['a', 1],
      nested: { key: 'value' },
    })).toEqual({
      fields: {
        text: { stringValue: 'hello', kind: 'stringValue' },
        count: { numberValue: 2, kind: 'numberValue' },
        enabled: { boolValue: true, kind: 'boolValue' },
        empty: { nullValue: 'NULL_VALUE', kind: 'nullValue' },
        list: {
          listValue: {
            values: [
              { stringValue: 'a', kind: 'stringValue' },
              { numberValue: 1, kind: 'numberValue' },
            ],
          },
          kind: 'listValue',
        },
        nested: {
          structValue: {
            fields: {
              key: { stringValue: 'value', kind: 'stringValue' },
            },
          },
          kind: 'structValue',
        },
      },
    });
  });

  it('omits zero or missing human approval timeout', () => {
    expect(buildGrpcHumanApprovalConfig({ promptTemplate: 'Approve?', timeoutSeconds: 0 })).toEqual({
      prompt_template: 'Approve?',
    });
    expect(buildGrpcHumanApprovalConfig(null)).toBeUndefined();
  });

  it('unwraps explicit proto-loader Struct and Value payloads', () => {
    expect(fromGrpcValue({
      fields: {
        text: { kind: 'stringValue', stringValue: 'hello' },
        count: { kind: 'numberValue', numberValue: 2 },
        enabled: { kind: 'boolValue', boolValue: true },
        empty: { kind: 'nullValue', nullValue: 'NULL_VALUE' },
        nested: {
          kind: 'structValue',
          structValue: {
            fields: {
              key: { kind: 'stringValue', stringValue: 'value' },
            },
          },
        },
        list: {
          kind: 'listValue',
          listValue: {
            values: [
              { kind: 'stringValue', stringValue: 'a' },
              { kind: 'numberValue', numberValue: 1 },
            ],
          },
        },
      },
    })).toEqual({
      text: 'hello',
      count: 2,
      enabled: true,
      empty: null,
      nested: { key: 'value' },
      list: ['a', 1],
    });
  });

  it('recurses plain objects that are already unwrapped by proto-loader', () => {
    expect(fromGrpcValue({
      token: 'hello',
      metadata: {
        fields: {
          quality: { stringValue: 'good' },
        },
      },
    })).toEqual({
      token: 'hello',
      metadata: { quality: 'good' },
    });
  });
});
