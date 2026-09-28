import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { PatchPlaybookFlowDeltaDto } from './patch-playbook-flow-delta.dto';

// The global pipe of main.ts.
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
  stopAtFirstError: true,
});
const transform = (body: unknown) => pipe.transform(body, { type: 'body', metatype: PatchPlaybookFlowDeltaDto });

describe('PatchPlaybookFlowDeltaDto through the global validation pipe', () => {
  const edge = { id: 'e1', kind: 'sequential', source: 'n1', target: 'n2', sourceOutputPortId: 'out', targetInputPortId: 'in', priority: 0 };
  const bindings = [
    { id: 'b1', targetNode: 'n2', targetPort: 'in', sourceKind: 'node-output', sourceNode: 'n1', sourcePort: 'out', iteration: 'current' },
    { id: 'b2', targetNode: 'n2', targetPort: 'cv', sourceKind: 'constant', iteration: 'current', constantValue: { kind: 'workspace', id: 'w1' } },
  ];

  it('keeps every field of the edges and bindings (implicit conversion used to turn each one into [])', async () => {
    const dto = (await transform({ expectedDefinitionRevision: 3, patch: { controlEdges: [edge], dataBindings: bindings } })) as PatchPlaybookFlowDeltaDto;
    expect(JSON.parse(JSON.stringify(dto.patch.controlEdges))).toEqual([edge]);
    expect(JSON.parse(JSON.stringify(dto.patch.dataBindings))).toEqual(bindings);
  });

  it('rejects a binding without its target instead of storing an empty one', async () => {
    await expect(transform({ expectedDefinitionRevision: 3, patch: { dataBindings: [{ id: 'b1', sourceKind: 'constant' }] } }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});
