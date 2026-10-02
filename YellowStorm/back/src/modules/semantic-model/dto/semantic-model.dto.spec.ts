import { ValidationPipe } from '@nestjs/common';
import { ComputedFieldPreviewDto, DocumentLabelsDto, GraphOperationsDto, SourceFieldMappingDto } from './semantic-model.dto';

describe('GraphOperationsDto', () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const transform = (operations: unknown[]) => pipe.transform(
    { expectedRevision: 0, operations },
    { type: 'body', metatype: GraphOperationsDto },
  );

  it('preserves frontend graph operation objects during transformation', async () => {
    const operation = {
      type: 'node_type.create',
      entity: { id: 'party', key: 'party', label: 'Party', position: { x: 10, y: 20 } },
    };

    const result = await transform([operation]);

    expect(result.operations).toEqual([operation]);
  });

  it.each(['invalid', 42, null, ['nested']])('rejects a non-object operation entry: %p', async (entry) => {
    await expect(transform([entry])).rejects.toThrow();
  });
});

describe('Computed field DTOs', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const computed = { input: { kind: 'file', name: 'document_name' }, method: 'split', delimiter: '_', part: -1, transform: 'upper' };

  it('accepts a computed mapping and a computed preview', async () => {
    const mapping = { sourceField: null, targetAttribute: 'code', mode: 'computed', computed };
    await expect(pipe.transform(mapping, { type: 'body', metatype: SourceFieldMappingDto })).resolves.toMatchObject({ computed });
    await expect(pipe.transform({ computed, samples: ['A_B.pdf'] }, { type: 'body', metatype: ComputedFieldPreviewDto }))
      .resolves.toMatchObject({ samples: ['A_B.pdf'] });
  });

  it('rejects an unknown method, an out-of-range part and empty samples', async () => {
    await expect(pipe.transform({ sourceField: null, targetAttribute: 'code', mode: 'computed', computed: { ...computed, method: 'eval' } },
      { type: 'body', metatype: SourceFieldMappingDto })).rejects.toBeDefined();
    await expect(pipe.transform({ computed: { ...computed, part: 21 }, samples: ['a'] },
      { type: 'body', metatype: ComputedFieldPreviewDto })).rejects.toBeDefined();
    await expect(pipe.transform({ computed, samples: [] }, { type: 'body', metatype: ComputedFieldPreviewDto })).rejects.toBeDefined();
  });
});

describe('Passage rules and document labels DTOs', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const extract = (rules: Record<string, unknown>) => pipe.transform(
    { sourceField: 'Définition', targetAttribute: 'definition', mode: 'extract', rules },
    { type: 'body', metatype: SourceFieldMappingDto });

  it('accepts passages after or before a label, whole pages and trimming', async () => {
    await expect(extract({ labels: ['Définition'], location: 'after_label', boundaryLabels: ['Données de marché'], transform: 'trim' }))
      .resolves.toMatchObject({ rules: { location: 'after_label', boundaryLabels: ['Données de marché'], transform: 'trim' } });
    await expect(extract({ location: 'before_label', labels: ['Note'] })).resolves.toBeDefined();
    await expect(extract({ transform: 'no_spaces' })).resolves.toMatchObject({ rules: { transform: 'no_spaces' } });
    await expect(extract({ location: 'pages', pages: { from: 2, to: 4 } })).resolves.toMatchObject({ rules: { pages: { from: 2, to: 4 } } });
  });

  it('keeps the first or last characters, words or lines, and refuses an empty or unknown cut', async () => {
    await expect(extract({ labels: ['Version'], location: 'after_label', take: { from: 'start', count: 10, unit: 'characters' } }))
      .resolves.toMatchObject({ rules: { take: { from: 'start', count: 10, unit: 'characters' } } });
    await expect(extract({ take: { count: 0 } })).rejects.toBeDefined();
    await expect(extract({ take: { count: 3, unit: 'pages' } })).rejects.toBeDefined();
  });

  it('rejects page zero, an unknown location and too many boundary labels', async () => {
    await expect(extract({ location: 'pages', pages: { from: 0 } })).rejects.toBeDefined();
    await expect(extract({ location: 'everywhere' })).rejects.toBeDefined();
    await expect(extract({ location: 'after_label', boundaryLabels: Array.from({ length: 11 }, (_, index) => `L${index}`) })).rejects.toBeDefined();
  });

  it('asks labels for one to ten documents', async () => {
    const labels = (documentIds: string[]) => pipe.transform({ workspaceId: 'ws-1', documentIds }, { type: 'body', metatype: DocumentLabelsDto });
    await expect(labels(['doc-1'])).resolves.toMatchObject({ documentIds: ['doc-1'] });
    await expect(labels([])).rejects.toBeDefined();
    await expect(labels(Array.from({ length: 11 }, (_, index) => `doc-${index}`))).rejects.toBeDefined();
  });
});
