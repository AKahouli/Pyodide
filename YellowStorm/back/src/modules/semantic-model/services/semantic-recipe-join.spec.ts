import { ValidationPipe } from '@nestjs/common';
import { checkDerivedSource, derivedFieldInputs, type DerivedFieldMapping } from '../domain/semantic-derived-source.types';
import type { ComputedFieldSpec, SourceFieldMapping } from '../domain/semantic-source-mapping.types';
import { ComputedFieldPreviewDto, SourceFieldMappingDto } from '../dto/semantic-model.dto';
import { SemanticSourceMappingService } from './semantic-source-mapping.service';

/** A recipe's input joining several parts (columns, fields, the file name, fixed texts) into one text. */
const join = (parts: unknown[], extra: Record<string, unknown> = {}) => ({ kind: 'join', parts, ...extra }) as ComputedFieldSpec['input'];
const field = (name: string) => ({ kind: 'field' as const, name });
const column = (name: string) => ({ kind: 'column' as const, name });
const text = (value: string) => ({ kind: 'text' as const, value });
const computed = (input: ComputedFieldSpec['input']): ComputedFieldSpec => ({ input, method: 'whole' });
const mapping = (targetAttribute: string, mode: SourceFieldMapping['mode'], extra: Partial<SourceFieldMapping> = {}): SourceFieldMapping =>
  ({ sourceField: null, targetAttribute, mode, ...extra });

describe('Joined recipe inputs', () => {
  // As the app's global pipe: implicit conversion must leave a joined preview's part samples as objects.
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } });
  const sender = join([field('name'), text(' <'), field('email'), text('>')], { separator: '', skipEmpty: true });

  it('accepts a joined input in a mapping and its preview, and refuses bad parts', async () => {
    const dto = { sourceField: null, targetAttribute: 'sender', mode: 'computed', computed: computed(sender) };
    await expect(pipe.transform(dto, { type: 'body', metatype: SourceFieldMappingDto })).resolves.toMatchObject({ computed: computed(sender) });
    await expect(pipe.transform({ computed: computed(sender), partSamples: [{ 'field:name': 'Jean' }] },
      { type: 'body', metatype: ComputedFieldPreviewDto })).resolves.toMatchObject({ partSamples: [{ 'field:name': 'Jean' }] });
    const refused = [
      join([field('name')]),
      join(Array.from({ length: 11 }, (_, index) => column(`c${index}`))),
      join([field('name'), text('x'.repeat(101))]),
      join([field('name'), text('')]),
      join([field('name'), { kind: 'join', parts: [] }]),
      join([field('name'), { kind: 'field' }]),
      join([field('name'), field('email')], { separator: 'x'.repeat(11) }),    ];
    for (const input of refused) {
      await expect(pipe.transform({ ...dto, computed: computed(input) }, { type: 'body', metatype: SourceFieldMappingDto })).rejects.toBeDefined();
    }
  });

  it('a document join reads the file name and read fields, never a computed field or a column', () => {
    const plain = [mapping('name', 'extract'), mapping('email', 'extract')];
    expect(() => SemanticSourceMappingService.assertMappingModes('document', [...plain,
      mapping('sender', 'computed', { computed: computed(sender) }),
      mapping('label', 'computed', { computed: computed(join([{ kind: 'file', name: 'document_name' }, field('name')])) })])).not.toThrow();
    const year = mapping('year', 'computed', { computed: computed({ kind: 'file', name: 'document_name' }) });
    for (const input of [join([field('name'), field('year')]), join([field('name'), field('missing')]), join([field('name'), column('x')]),
      join([field('both'), field('name')]), join([text('a'), text('b')])]) {
      expect(() => SemanticSourceMappingService.assertMappingModes('document', [...plain, year,
        mapping('both', 'computed', { computed: computed(input) })])).toThrow();
    }
  });

  it('a sheet join reads columns and fields read from a column, with no chains', () => {
    const first = mapping('first', 'direct', { sourceField: 'First' });
    const last = mapping('last', 'direct', { sourceField: 'Last', computed: computed(column('Last')) });
    const full = mapping('full', 'computed', { computed: computed(join([field('first'), field('last'), column('Title')])) });
    expect(() => SemanticSourceMappingService.assertMappingModes('excel_sheet', [first, last, full])).not.toThrow();
    const chained = [
      mapping('initials', 'computed', { computed: computed(field('full')) }),
      mapping('initials', 'computed', { computed: computed(join([field('full'), column('x')])) }),
      mapping('initials', 'computed', { computed: computed(join([column('x'), { kind: 'file', name: 'document_name' }])) }),
      mapping('initials', 'computed', { computed: computed(join([column('x'), field('initials')])) }),
    ];
    for (const item of chained) {
      expect(() => SemanticSourceMappingService.assertMappingModes('excel_sheet', [first, last, full, item])).toThrow();
    }
  });

  it('a record join names every source field it reads, and is left out when one is gone', () => {
    const fields: DerivedFieldMapping[] = [
      { sourceAttribute: 'customer_id', targetAttribute: 'org_id' },
      { sourceAttribute: 'customer_name', targetAttribute: 'name' },
      { targetAttribute: 'label', mode: 'computed', computed: computed(join([field('name'), text('·'), column('country'), column('customer_id')])) },
    ];
    expect(derivedFieldInputs(fields[2], fields)).toEqual(['customer_name', 'country', 'customer_id']);
    const all = new Set(['customer_id', 'customer_name', 'country']);
    const targets = new Set(['org_id', 'name', 'label']);
    expect(checkDerivedSource({ fieldMappings: fields, conflictRule: 'most_frequent', orderBy: null }, all, targets, ['org_id'])
      .fieldMappings).toHaveLength(3);
    expect(checkDerivedSource({ fieldMappings: fields, conflictRule: 'most_frequent', orderBy: null },
      new Set(['customer_id', 'customer_name']), targets, ['org_id']).fieldMappings).toHaveLength(2);
  });

  it('forwards part samples for a joined preview and refuses oversized ones', async () => {
    const models = { requireActiveRole: jest.fn().mockResolvedValue({ id: 'model-1' }) };
    const runtime = { previewComputedField: jest.fn().mockResolvedValue({ results: [] }) };
    const service = new SemanticSourceMappingService({} as never, models as never, {} as never, runtime as never, {} as never);
    const partSamples = [{ 'field:name': 'Jean', 'field:email': 'j@x.org' }];
    await service.previewComputed('user-1', 'model-1', { computed: computed(sender), partSamples } as never);
    expect(runtime.previewComputedField).toHaveBeenCalledWith({ computed: computed(sender), samples: [], partSamples });
    await expect(service.previewComputed('user-1', 'model-1', { computed: computed(sender), partSamples: [{ 'field:name': 'x'.repeat(1001) }] } as never))
      .rejects.toThrow();
    await expect(service.previewComputed('user-1', 'model-1', { computed: computed(sender) } as never)).rejects.toThrow();
  });
});
