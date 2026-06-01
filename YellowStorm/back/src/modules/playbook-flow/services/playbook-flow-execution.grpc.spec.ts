import {
  buildGrpcHumanApprovalConfig,
  isTerminalStatus,
  toGrpcStruct,
  toGrpcValue,
} from './playbook-flow-execution.service';

describe('buildGrpcHumanApprovalConfig', () => {
  it('omits timeout_seconds when timeout is null so the runtime can apply its default', () => {
    expect(buildGrpcHumanApprovalConfig({ promptTemplate: 'Approve this', timeoutSeconds: null })).toEqual({
      prompt_template: 'Approve this',
    });
  });

  it('omits zero because proto3 cannot distinguish it from an unset int32', () => {
    expect(buildGrpcHumanApprovalConfig({ promptTemplate: 'Approve this', timeoutSeconds: 0 })).toEqual({
      prompt_template: 'Approve this',
    });
  });

  it('preserves explicit positive timeout values', () => {
    expect(buildGrpcHumanApprovalConfig({ promptTemplate: 'Approve this', timeoutSeconds: 900 })).toEqual({
      prompt_template: 'Approve this',
      timeout_seconds: 900,
    });
  });
});

describe('isTerminalStatus', () => {
  it('returns true for completed, failed, cancelled', () => {
    expect(isTerminalStatus('completed')).toBe(true);
    expect(isTerminalStatus('failed')).toBe(true);
    expect(isTerminalStatus('cancelled')).toBe(true);
  });

  it('returns false for non-terminal statuses', () => {
    expect(isTerminalStatus('queued')).toBe(false);
    expect(isTerminalStatus('running')).toBe(false);
    expect(isTerminalStatus('pending_approval')).toBe(false);
  });
});

describe('gRPC Struct helpers', () => {
  it('wraps nested objects using protobuf Struct/Value shapes', () => {
    expect(
      toGrpcStruct({
        metadata: { fields: { preserved: true } },
        items: [1, 'two'],
      }),
    ).toEqual({
      fields: {
        metadata: {
          kind: 'structValue',
          structValue: {
            fields: {
              fields: {
                kind: 'structValue',
                structValue: {
                  fields: {
                    preserved: { kind: 'boolValue', boolValue: true },
                  },
                },
              },
            },
          },
        },
        items: {
          kind: 'listValue',
          listValue: {
            values: [
              { kind: 'numberValue', numberValue: 1 },
              { kind: 'stringValue', stringValue: 'two' },
            ],
          },
        },
      },
    });
  });

  it('wraps constant values consistently for protobuf.Value fields', () => {
    expect(toGrpcValue({ nested: 'value' })).toEqual({
      kind: 'structValue',
      structValue: {
        fields: {
          nested: {
            kind: 'stringValue',
            stringValue: 'value',
          },
        },
      },
    });
  });
});
