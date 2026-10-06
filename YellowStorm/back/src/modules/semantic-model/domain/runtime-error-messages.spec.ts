import { runtimeErrorMessage, runtimeUnreachableMessage } from './runtime-error-messages';

describe('runtime error messages', () => {
  it('says what a known runtime code means', () => {
    expect(runtimeErrorMessage({ detail: 'no_data_in_use' }, 'fallback')).toMatch(/Run the whole model once/);
    expect(runtimeErrorMessage({ errorCode: 'invalid_relation_bindings' }, 'fallback')).toMatch(/A link matches records/);
  });

  it('lists the fields a malformed request got wrong', () => {
    const message = runtimeErrorMessage({ detail: [
      { loc: ['body', 'payload', 'sources'], msg: 'Value error, a run reads at least one source' },
    ] }, 'fallback');
    expect(message).toBe('The semantic runtime refused the request (payload › sources: a run reads at least one source).');
  });

  it('keeps a sentence as it is, and an unknown code beside the fallback', () => {
    expect(runtimeErrorMessage({ detail: 'The sheet has no header row' }, 'fallback')).toBe('The sheet has no header row');
    expect(runtimeErrorMessage({ detail: 'brand_new_code' }, 'It failed')).toBe('It failed (brand_new_code)');
    expect(runtimeErrorMessage(undefined, 'It failed')).toBe('It failed');
  });

  it('tells a runtime that is down from one that is slow', () => {
    expect(runtimeUnreachableMessage(Object.assign(new Error('x'), { name: 'TimeoutError' }))).toMatch(/did not answer in time/);
    expect(runtimeUnreachableMessage(new TypeError('fetch failed'))).toMatch(/cannot be reached/);
  });
});
