import { ValidationPipe } from '@nestjs/common';
import { GraphOperationsDto } from './semantic-model.dto';

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
