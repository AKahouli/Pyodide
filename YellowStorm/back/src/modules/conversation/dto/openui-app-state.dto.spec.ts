import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { isValidOpenUiAppState, PutOpenUiAppStateDto } from './openui-app-state.dto';

describe('OpenUI private draft transport', () => {
  const body = (state: unknown = { number: 0, enabled: false, empty: '', optional: null, nested: [1, true] }) => ({
    schemaVersion: 1, libraryVersion: 'yellowstorm-miniapp-v1', programDigest: 'a'.repeat(64), expectedRevision: 0, state });
  it('preserves unsubmitted typed values and rejects extra actor identity', async () => {
    const dto = plainToInstance(PutOpenUiAppStateDto, body());
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
    expect(dto.state).toEqual(body().state);
    expect(await validate(plainToInstance(PutOpenUiAppStateDto, { ...body(), actorId: 'a'.repeat(24) }),
      { whitelist: true, forbidNonWhitelisted: true })).not.toEqual([]);
  });
  it('rejects dangerous JSON before class-transformer can discard its keys', () => {
    const dangerous = JSON.parse('{"nested":{"__proto__":{"polluted":true}}}');
    expect(() => plainToInstance(PutOpenUiAppStateDto, body(dangerous))).toThrow();
    expect(isValidOpenUiAppState(dangerous)).toBe(false);
  });
  it('bounds bytes, depth, nodes and JSON types', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 10; i++) deep = { deep };
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    for (const invalid of [null, [], { value: Infinity }, { value: undefined }, { date: new Date() },
      { value: '界'.repeat(7000) }, { value: '\u0000' }, { value: '\uD800' }, { values: Array(201).fill(0) }, deep, cycle]) {
      expect(isValidOpenUiAppState(invalid)).toBe(false);
    }
  });
  it.each([-1, 0.2, 2_147_483_647, 2_147_483_648, 2 ** 40, Number.MAX_SAFE_INTEGER + 1, '0'])('rejects invalid revision %p', async expectedRevision => {
    expect(await validate(plainToInstance(PutOpenUiAppStateDto, { ...body(), expectedRevision }))).not.toEqual([]);
  });
});
