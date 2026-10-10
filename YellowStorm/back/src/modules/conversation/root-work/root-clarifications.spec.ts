import { acceptedRootClarifications, mergeRootClarifications } from './root-clarifications';
import type { RootNativeState } from './root-work.types';

describe('accepted clarification provenance', () => {
  const state = { invocationId: 'invocation', pendingInputs: [
    { inputId: 'origin', inputVersion: 1, functionName: 'adk_request_input', message: 'Where from?' },
    { inputId: 'approval', functionName: 'adk_request_confirmation' },
  ] } as RootNativeState;
  const submission = [{ inputId: 'origin', inputVersion: 1, response: { city: 'Paris' } }];
  it('retains exact user constraints independently from approvals', () => {
    const accepted = acceptedRootClarifications(state, [...submission, { inputId: 'approval', response: { confirmed: true } }]);
    expect(accepted).toHaveLength(1);
    expect(accepted[0]).toMatchObject({ question: 'Where from?', response: { city: 'Paris' } });
    expect(acceptedRootClarifications(state, [])).toEqual([]);
    expect(accepted[0].response).not.toBe(submission[0].response);
  });
  it('preserves stale updates and deduplicates replay but rejects a conflicting answer', () => {
    const accepted = acceptedRootClarifications(state, submission);
    expect(mergeRootClarifications(accepted)).toEqual(accepted);
    expect(acceptedRootClarifications({ ...state, clarifications: accepted }, submission)).toEqual(accepted);
    expect(() => acceptedRootClarifications({ ...state, clarifications: accepted }, [
      { ...submission[0], response: { city: 'Lyon' } },
    ])).toThrow('conflicts');
  });
  it('bounds retained response context', () => {
    expect(() => acceptedRootClarifications(state, [{ ...submission[0], response: { value: 'x'.repeat(262144) } }]))
      .toThrow('limit');
  });
});
