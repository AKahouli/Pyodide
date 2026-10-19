import { describe, expect, it } from 'vitest';
import type { ActionEvent } from '@openuidev/react-lang';
import { formatFormValues, submissionSignature, toFollowUpMessage, typedActionData } from './actions';

const event = (overrides: Partial<ActionEvent>): ActionEvent => ({ type: 'continue_conversation', params: {}, humanFriendlyMessage: '', ...overrides });

describe('toFollowUpMessage', () => {
  const artifact = { artifactId: 'owned', filename: 'report.docx', availability: 'ready' as const };
  it('resolves file actions and old sandbox links only against ready artifacts on this answer', () => {
    for (const action of [
      { type: 'download_artifact', params: { filename: 'report.docx' } },
      { type: 'download_file', params: { artifactId: 'owned' } },
      { type: 'open_url', params: { url: 'sandbox:/mnt/yellowmind/run/outputs/report.docx' } },
      { type: 'open_url', params: { url: 'artifacts/main/report.docx' } },
    ]) expect(toFollowUpMessage(event(action), [artifact])).toEqual({ kind: 'download-artifact', artifact });
    expect(toFollowUpMessage(event({ type: 'download_artifact', params: { artifactId: 'other-answer' } }), [artifact])).toEqual({ kind: 'ignore' });
    expect(toFollowUpMessage(event({ type: 'download_artifact', params: { filename: 'report.docx' } }), [{ ...artifact, availability: 'pending' }])).toEqual({ kind: 'ignore' });
    expect(toFollowUpMessage(event({ type: 'download_artifact', params: { filename: 'report.docx' } }), [artifact, { ...artifact, artifactId: 'duplicate' }])).toEqual({ kind: 'ignore' });
    expect(toFollowUpMessage(event({ type: 'open_url', params: { url: 'https://example.com/report.docx' } }), [artifact])).toEqual({ kind: 'open-url', url: 'https://example.com/report.docx' });
  });
  it('sends the button label as the follow-up message', () => {
    expect(toFollowUpMessage(event({ humanFriendlyMessage: ' Tell me more ' }))).toEqual({ kind: 'message', content: 'Tell me more' });
  });

  it('appends submitted form values as readable name: value lines', () => {
    expect(toFollowUpMessage(event({ humanFriendlyMessage: 'Submit', formState: { city: 'Paris' } })))
      .toMatchObject({ kind: 'message', content: 'Submit\n\ncity: Paris', submission: { formState: { city: 'Paris' } } });
  });

  it('unwraps OpenUI field entries, form groups, lists and empty fields', () => {
    const formState = { booking: {
      city: { value: 'Paris', componentType: 'Input' },
      guests: { value: 2, componentType: 'Slider' },
      options: { value: ['wifi', 'parking'], componentType: 'CheckBoxGroup' },
      notes: { value: '', componentType: 'TextArea' },
      newsletter: { value: false, componentType: 'SwitchItem' },
    } };
    expect(formatFormValues(formState)).toEqual(['city: Paris', 'guests: 2', 'options: wifi, parking', 'newsletter: false']);
    expect(toFollowUpMessage(event({ humanFriendlyMessage: 'Book', formState })))
      .toMatchObject({ kind: 'message', content: 'Book\n\ncity: Paris\nguests: 2\noptions: wifi, parking\nnewsletter: false', submission: { formState } });
  });

  it('preserves explicit empty values rather than dropping a submission', () => {
    expect(toFollowUpMessage(event({ formState: { a: { value: '', componentType: 'Input' } } })))
      .toMatchObject({ kind: 'message', submission: { formState: { a: { value: '', componentType: 'Input' } } } });
  });

  it('preserves nested typed form values and chart/table filter parameters', () => {
    const formState = { filters: { count: { value: 0, componentType: 'Slider' }, enabled: { value: false, componentType: 'SwitchItem' }, empty: null, values: [1, '1', false, ''] } };
    expect(toFollowUpMessage(event({ formName: 'filters', formState, params: { selectedRow: 0, range: [0, 10] } })))
      .toMatchObject({ submission: { formName: 'filters', formState, params: { selectedRow: 0, range: [0, 10] } } });
    expect(submissionSignature({ b: 1, a: false })).toBe(submissionSignature({ a: false, b: 1 }));
  });

  it.each([NaN, Infinity, undefined, new Date(), () => 1])('rejects non-JSON values %s', value => {
    expect(() => typedActionData({ value })).toThrow();
  });

  it('rejects dangerous keys, oversized and excessively nested payloads', () => {
    expect(() => typedActionData(JSON.parse('{"__proto__":{}}'))).toThrow();
    expect(() => typedActionData({ text: 'x'.repeat(20001) })).toThrow();
    let nested: unknown = null;
    for (let i = 0; i < 10; i++) nested = { child: nested };
    expect(() => typedActionData(nested)).toThrow();
  });

  it('ignores an action with neither label nor form values', () => {
    expect(toFollowUpMessage(event({}))).toEqual({ kind: 'ignore' });
  });

  it('opens http(s) links only', () => {
    expect(toFollowUpMessage(event({ type: 'open_url', params: { url: 'https://example.com/a' } }))).toEqual({ kind: 'open-url', url: 'https://example.com/a' });
    expect(toFollowUpMessage(event({ type: 'open_url', params: { url: 'javascript:alert(1)' } }))).toEqual({ kind: 'ignore' });
    expect(toFollowUpMessage(event({ type: 'open_url', params: { url: 'not a url' } }))).toEqual({ kind: 'ignore' });
    expect(toFollowUpMessage(event({ type: 'open_url', params: {} }))).toEqual({ kind: 'ignore' });
  });

  it('ignores unknown action types', () => {
    expect(toFollowUpMessage(event({ type: 'custom', humanFriendlyMessage: 'x' }))).toEqual({ kind: 'ignore' });
  });
});
