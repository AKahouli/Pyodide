import 'reflect-metadata';
import { expectContract } from '../expect-contract';
import { toWire, callPrivate, expectNoMongoKeys, expectNoKeys } from '../wire-helpers';
import { AppearanceLogoService } from '@modules/system/services/appearance-logo.service';
import type { AppearanceLogoRecord } from '@modules/system/persistence/appearance-logo.store';

const logo: AppearanceLogoRecord = {
  id: '64b000000000000000000301',
  name: 'Corporate logo',
  contentType: 'image/png',
  width: 128,
  height: 64,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
};

describe('system appearance logo list contract', () => {
  const svc = (): AppearanceLogoService =>
    Object.assign(Object.create(AppearanceLogoService.prototype), {
      logoStore: { list: async () => [logo] },
    });

  it('listPublic returns builtin + custom logos without binary data', async () => {
    const list = toWire<any[]>(await svc().listPublic());
    const custom = list.find((l) => l.kind === 'custom');
    const builtin = list.find((l) => l.kind === 'builtin');
    expect(builtin).toBeDefined();
    expectContract('system/appearance-logo-custom', custom);
    expectContract('system/appearance-logo-builtin', builtin);
    expect(custom.id).toBe(logo.id);
    expect(custom.url).toBe(`/experimental/system/appearance/logos/${logo.id}/file`);
    expectNoMongoKeys(list);
    expectNoKeys(list, 'data', 'buffer');
  });

  it('toPublic (private) matches the custom fixture', () => {
    const body = toWire(callPrivate(AppearanceLogoService, 'toPublic', [logo]));
    expectContract('system/appearance-logo-custom', body);
  });
});
