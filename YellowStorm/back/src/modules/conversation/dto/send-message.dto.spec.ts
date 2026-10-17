import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { isValidOpenUiSubmission, SendMessageDto } from './send-message.dto';
const submission = () => ({ type: 'openui', schemaVersion: 1, sourceMessageId: 'a'.repeat(24), componentId: 'text-1',
  actionType: 'continue_conversation', formName: 'preferences', label: 'Continue',
  formState: { enabled: { componentType: 'Checkbox', value: false }, count: 0, ratio: 1.25, empty: '',
    optional: null, values: ['x', 2, true, null], nested: { list: [] } }, params: {} });
describe('OpenUI submission transport bounds', () => {
  it('accepts a mini-app agent action without coercing its submitted values', async () => {
    const inputs = { sourceText: 'Pilot budget: 0 euros.', length: 'detailed', bullets: false, count: 0 };
    const input = { content: 'Summarize', openUiSubmission: { ...submission(), formName: 'summary',
      label: 'Summarize', formState: { ...inputs, optional: null },
      params: { instruction: 'Summarize the supplied text.', inputs } } };
    const dto = plainToInstance(SendMessageDto, input);
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    expect(dto.openUiSubmission).toEqual(input.openUiSubmission);
    expect(dto.openUiSubmission?.params?.inputs).toEqual(inputs);
  });
  it('retains typed JSON through DTO transformation and validation', async () => {
    const input = { content: '', openUiSubmission: submission() };
    const dto = plainToInstance(SendMessageDto, input);
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    expect(dto.openUiSubmission).toEqual(input.openUiSubmission);
    expect(typeof dto.openUiSubmission!.formState.count).toBe('number');
  });
  it.each([undefined, null, [], new Date(), Number.NaN, Infinity, () => undefined])('rejects non-JSON formState %p', value => {
    expect(isValidOpenUiSubmission({ ...submission(), formState: value })).toBe(false);
  });
  it('rejects cycles, nonfinite values, sparse arrays, excessive depth/items/UTF8 bytes', () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    let deep: Record<string, unknown> = {}; for (let index = 0; index < 9; index++) deep = { child: deep };
    for (const formState of [cyclic, { value: Infinity }, { array: Array(2) }, deep,
      { values: Array.from({ length: 201 }, () => 0) }, { value: String.fromCharCode(30028).repeat(7000) }]) {
      expect(isValidOpenUiSubmission({ ...submission(), formState })).toBe(false);
    }
  });
  it.each(['__proto__', 'constructor', 'prototype'])('rejects dangerous keys before transformer can strip %s', async key => {
    const value = JSON.parse(`{"${key}":{"polluted":true}}`);
    expect(() => plainToInstance(SendMessageDto, { content: '',
      openUiSubmission: { ...submission(), formState: value } })).toThrow('Invalid OpenUI submission');
    expect(isValidOpenUiSubmission({ ...submission(), params: { nested: value } })).toBe(false);
  });
  it('rejects invalid routing fields and unknown metadata without coercion', () => {
    for (const patch of [{ schemaVersion: '1' }, { type: 'choice' }, { actionType: 'navigate' },
      { sourceMessageId: 'foreign' }, { componentId: '' }, { formName: 'x'.repeat(129) },
      { label: 'x'.repeat(1001) }, { extra: true }, { params: [] }]) {
      expect(isValidOpenUiSubmission({ ...submission(), ...patch })).toBe(false);
    }
  });
});
