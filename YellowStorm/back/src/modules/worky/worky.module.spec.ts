import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { MODULE_METADATA, GUARDS_METADATA } from '@nestjs/common/constants';
import type { Provider, Type } from '@nestjs/common';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { WorkyModule } from './worky.module';
import * as persistence from './persistence';
import { WORKY_REPOSITORIES } from './persistence';

/**
 * The module lost its MongooseModule.forFeature list in the Postgres cutover, so a repository nobody
 * registered would only fail when the app boots. This builds the module's own providers and
 * controllers with everything that comes from other modules replaced by an empty stand-in, so the
 * check is about the wiring inside worky: each service can get every repository it asks for.
 */
describe('WorkyModule wiring', () => {
  const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, WorkyModule) as Type[];
  const controllers = Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, WorkyModule) as Type[];
  const own = new Set<unknown>(providers);

  /** Constructor dependencies of a class: `@Inject(token)` where given, else the design-time type. */
  const dependencies = (cls: Type): unknown[] => {
    const types = (Reflect.getMetadata('design:paramtypes', cls) ?? []) as unknown[];
    const injected = (Reflect.getMetadata('self:paramtypes', cls) ?? []) as { index: number; param: unknown }[];
    return types.map((type, index) => injected.find((i) => i.index === index)?.param ?? type);
  };
  const guardsOf = (cls: Type): Type[] => {
    const onClass = (Reflect.getMetadata(GUARDS_METADATA, cls) ?? []) as Type[];
    const onMethods = Object.getOwnPropertyNames(cls.prototype)
      .map((name) => Object.getOwnPropertyDescriptor(cls.prototype, name)?.value as unknown)
      .filter((method): method is (...args: unknown[]) => unknown => typeof method === 'function')
      .flatMap((method) => (Reflect.getMetadata(GUARDS_METADATA, method) ?? []) as Type[]);
    return [...onClass, ...onMethods];
  };

  /** Any method call on it returns undefined: enough for constructors that only read a value or set a context. */
  const standIn = (): unknown => new Proxy({}, { get: (_target, prop) => (prop === 'then' ? undefined : jest.fn()) });

  it('registers every repository as a provider', () => {
    for (const repository of WORKY_REPOSITORIES) expect(own.has(repository)).toBe(true);
  });

  it('resolves every service, guard and controller with the module\'s own providers', async () => {
    const standIns = new Map<unknown, Provider>();
    const needed = [...providers, ...controllers];
    const repositories = new Set<unknown>(Object.values(persistence));
    const unregistered: string[] = [];
    for (const cls of needed) {
      for (const dep of [...dependencies(cls), ...guardsOf(cls)]) {
        if (dep === DRIZZLE_DB || own.has(dep) || dep === Object || dep === undefined) continue;
        // A repository of this module is never somebody else's: it must be a provider, not a stand-in.
        if (repositories.has(dep)) unregistered.push(`${cls.name} needs ${(dep as Type).name}`);
        else standIns.set(dep, { provide: dep as Type, useValue: standIn() });
      }
    }
    expect(unregistered).toEqual([]);
    const module = await Test.createTestingModule({
      controllers,
      providers: [...providers, { provide: DRIZZLE_DB, useValue: standIn() }, ...standIns.values()],
    }).compile();
    for (const cls of needed) expect(() => module.get(cls, { strict: false })).not.toThrow();
    await module.close();
  });
});
