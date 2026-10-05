import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Permissions } from '@modules/authorization/constants/permissions';
import { PERMISSIONS_KEY } from '@modules/authorization/decorators/require-permissions.decorator';
import { SemanticExtractionSettingsController } from '../controllers/semantic-extraction-settings.controller';
import { SearchIndexSettingsDto, SearchQuerySettingsDto } from '../dto/semantic-search-settings.dto';
import {
  fieldSearchIndexProblems, pickFieldSearchIndex, pickSearchQuerySettings, searchIndexProblems, searchQueryProblems,
} from '../domain/semantic-search-settings.types';
import { parseSemanticGraphOperation } from '../domain/semantic-graph-operation.parser';
import { SemanticSearchSettingsService } from './semantic-search-settings.service';

// The authorization module index pulls the whole user module in; only its decorator and constants matter here.
jest.mock('@modules/authorization', () => ({
  Permissions: jest.requireActual('@modules/authorization/constants/permissions').Permissions,
  RequirePermissions: jest.requireActual('@modules/authorization/decorators/require-permissions.decorator').RequirePermissions,
  PermissionsGuard: class PermissionsGuard {},
}));

function service(stored: { index?: unknown; search?: unknown } = {}) {
  const database = {
    query: jest.fn(async (sql: string, _params?: unknown[]) => {
      if (sql.startsWith('SELECT index_settings')) return { rows: stored.index ? [{ value: stored.index }] : [] };
      if (sql.startsWith('SELECT search_settings')) return { rows: stored.search ? [{ value: stored.search }] : [] };
      return { rows: [] };
    }),
  };
  return { database, settings: new SemanticSearchSettingsService(database as never) };
}

describe('graph search settings: bounds and consistency', () => {
  it('accepts the built-in values and any consistent change', () => {
    expect(searchIndexProblems({})).toEqual([]);
    expect(searchIndexProblems({ passageTargetChars: 600, passageMinChars: 400, passageMaxChars: 800, passageOverlapChars: 100 })).toEqual([]);
    expect(searchQueryProblems({ minSimilarity: 0.35, extraStopWords: ['merci', 'cordialement'] })).toEqual([]);
  });

  it('rejects values out of range and values that do not fit together', () => {
    expect(searchIndexProblems({ passageMinChars: 1000 })).toEqual(['passage sizes must be min < target < max']);
    expect(searchIndexProblems({ passageOverlapChars: 700 })).toEqual(['passageOverlapChars must be below passageMinChars']);
    expect(searchIndexProblems({ longFieldChars: 400 })).toEqual(['longFieldChars must be at most cardValueChars']);
    expect(searchIndexProblems({ cardValueChars: 1500, cardTextChars: 1000 })).toEqual(['cardTextChars must be at least cardValueChars']);
    expect(searchIndexProblems({ maxPassagesPerField: 60 })).toEqual(['maxPassagesPerRecord must be at least maxPassagesPerField']);
    expect(searchIndexProblems({ passageTargetChars: 10.5 })[0]).toMatch(/whole number from 200 to 4000/);
    expect(searchIndexProblems({ unknown: 1 })).toEqual(['unknown is not a setting']);
    expect(searchQueryProblems({ defaultLimit: 30 })).toEqual(['defaultLimit must be at most maxLimit']);
    expect(searchQueryProblems({ minSimilarity: 1.2 })[0]).toMatch(/from 0 to 1/);
    expect(searchQueryProblems({ extraStopWords: ['x'.repeat(41)] })[0]).toMatch(/extraStopWords/);
  });

  it('checks a field\'s own settings merged over the global ones', () => {
    expect(fieldSearchIndexProblems({ passageTargetChars: 600, passageMinChars: 400, passageMaxChars: 800 })).toEqual([]);
    expect(fieldSearchIndexProblems({ passageMinChars: 1100 })).toEqual(['searchIndex: passage sizes must be min < target < max']);
    expect(fieldSearchIndexProblems({ passages: 'yes' })).toEqual(['searchIndex: passages must be true or false']);
    expect(pickFieldSearchIndex({ passages: false, passageTargetChars: 'x' })).toEqual({ passages: false });
    expect(pickFieldSearchIndex({})).toBeUndefined();
    expect(pickSearchQuerySettings({ extraStopWords: [' Merci ', 'merci', '', 3], rrfK: 2.5 })).toEqual({ extraStopWords: ['Merci'] });
  });

  it('keeps a field\'s own settings on its definition, checked like the admin\'s', () => {
    const attribute = (searchIndex: unknown) => ({ type: 'node_type.update', id: '00000000-0000-4000-8000-000000000001',
      changes: { attributes: [{ key: 'corps', label: 'Corps', type: 'text', required: false, searchIndex }] } });
    expect(() => parseSemanticGraphOperation(attribute({ passages: true, passageOverlapChars: 100 }))).not.toThrow();
    expect(() => parseSemanticGraphOperation(attribute({ passageMinChars: 2000 }))).toThrow(/attribute.searchIndex/);
    expect(() => parseSemanticGraphOperation(attribute({ other: 1 }))).toThrow(/not a setting/);
  });
});

describe('graph search settings DTOs', () => {
  it('bound each value and drop nothing valid', async () => {
    expect(await validate(plainToInstance(SearchIndexSettingsDto, { passageTargetChars: 900, passageHeader: false }))).toHaveLength(0);
    expect(await validate(plainToInstance(SearchIndexSettingsDto, { passageTargetChars: 50 }))).toHaveLength(1);
    expect(await validate(plainToInstance(SearchIndexSettingsDto, { passageHeader: 'no' }))).toHaveLength(1);
    expect(await validate(plainToInstance(SearchQuerySettingsDto, { minSimilarity: 0.42, extraStopWords: ['merci'] }))).toHaveLength(0);
    expect(await validate(plainToInstance(SearchQuerySettingsDto, { rrfK: 0.5 }))).toHaveLength(1);
    expect(await validate(plainToInstance(SearchQuerySettingsDto, { extraStopWords: ['x'.repeat(41)] }))).toHaveLength(1);
  });

  it('are changed by admins only; readers of a model see the settings in force', () => {
    const permissions = (method: keyof SemanticExtractionSettingsController) =>
      Reflect.getMetadata(PERMISSIONS_KEY, SemanticExtractionSettingsController.prototype[method]);
    for (const method of ['getSearchIndexSettings', 'updateSearchIndexSettings', 'getSearchQuerySettings', 'updateSearchQuerySettings'] as const) {
      expect(permissions(method)).toEqual([Permissions.ADMIN_ALL]);
    }
    expect(permissions('getEffectiveSearchSettings')).toEqual([Permissions.SEMANTIC_MODELS_READ, Permissions.SEMANTIC_MODELS_ALL]);
  });
});

describe('SemanticSearchSettingsService', () => {
  it('returns every setting filled in and which ones the admin set', async () => {
    const { settings } = service({ index: { cardValueChars: 500, bogus: 1 }, search: { minSimilarity: 0.3 } });
    const index = await settings.getIndexSettings();
    expect(index.configured).toEqual({ cardValueChars: 500 });
    // The threshold follows the card value cap unless it was set.
    expect(index.settings).toMatchObject({ cardValueChars: 500, longFieldChars: 500, passageTargetChars: 1000 });
    const search = await settings.getQuerySettings();
    expect(search.settings).toMatchObject({ minSimilarity: 0.3, rrfK: 60, defaultLimit: 10, maxLimit: 25, stopWords: true });
  });

  it('saves only what the admin set, and refuses what does not fit', async () => {
    const { settings, database } = service();
    await settings.updateIndexSettings('admin-1', { passageTargetChars: 900, passageMinChars: undefined });
    const write = database.query.mock.calls.find(([sql]) => String(sql).startsWith('INSERT'))!;
    expect(write[0]).toMatch(/index_settings/);
    expect(write[1]).toEqual(['{"passageTargetChars":900}', 'admin-1']);
    await expect(settings.updateIndexSettings('admin-1', { passageMinChars: 1000 })).rejects.toThrow(/min < target < max/);
    await expect(settings.updateQuerySettings('admin-1', { defaultLimit: 40 })).rejects.toThrow(/defaultLimit/);
  });

  it('forwards the admin values and each field\'s own settings by concept and field key', async () => {
    const { settings } = service({ index: { passageTargetChars: 900 }, search: { rrfK: 30 } });
    const graph = { nodes: [
      { key: 'email', attributes: [
        { key: 'corps', searchIndex: { passageTargetChars: 600, passageMinChars: 400, passageMaxChars: 800 } },
        { key: 'sujet' },
        // Does not fit the global sizes any more (min 950 > target 900): left out, never failing a search.
        { key: 'resume', searchIndex: { passageMinChars: 950 } },
      ] },
      { key: 'contract', attributes: [{ key: 'text', searchIndex: { passages: false } }] },
    ] };
    expect(await settings.runtimePayload(graph as never)).toEqual({
      index: { passageTargetChars: 900, fields: { email: { corps: { passageTargetChars: 600, passageMinChars: 400, passageMaxChars: 800 } },
        contract: { text: { passages: false } } } },
      search: { rrfK: 30 },
    });
    expect(await service().settings.runtimePayload(null)).toEqual({ index: {}, search: {} });
  });
});
