import { describe, expect, it } from 'vitest';
import type { ActionEvent } from '@openuidev/react-lang';
import { formatFormValues, toFollowUpMessage } from './actions';

const event = (overrides: Partial<ActionEvent>): ActionEvent => ({ type: 'continue_conversation', params: {}, humanFriendlyMessage: '', ...overrides });

describe('toFollowUpMessage', () => {
  it('sends the button label as the follow-up message', () => {
    expect(toFollowUpMessage(event({ humanFriendlyMessage: ' Tell me more ' }))).toEqual({ kind: 'message', content: 'Tell me more' });
  });

  it('appends submitted form values as readable name: value lines', () => {
    expect(toFollowUpMessage(event({ humanFriendlyMessage: 'Submit', formState: { city: 'Paris' } })))
      .toEqual({ kind: 'message', content: 'Submit\n\ncity: Paris' });
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
      .toEqual({ kind: 'message', content: 'Book\n\ncity: Paris\nguests: 2\noptions: wifi, parking\nnewsletter: false' });
  });

  it('ignores a submit whose fields are all empty when it has no label', () => {
    expect(toFollowUpMessage(event({ formState: { a: { value: '', componentType: 'Input' } } }))).toEqual({ kind: 'ignore' });
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
