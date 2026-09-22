import { validateSync } from 'class-validator';
import { FlowNodeTemplateRouterConditionDto } from './flow-node-template-fields.dto';
import { RouterConditionDto } from './playbook-flow-node.dto';

describe('FlowNodeTemplateRouterConditionDto', () => {
  it('accepts list membership operators', () => {
    const dto = new FlowNodeTemplateRouterConditionDto();
    dto.label = 'documents';
    dto.sourcePort = 'output-data';
    dto.operator = 'in';
    dto.value = ['pdf', 'txt'];

    expect(validateSync(dto)).toEqual([]);
  });
});

describe('RouterConditionDto', () => {
  it('accepts list membership operators', () => {
    const dto = new RouterConditionDto();
    dto.label = 'documents';
    dto.sourcePort = 'output-data';
    dto.operator = 'in';
    dto.value = ['pdf', 'txt'];

    expect(validateSync(dto)).toEqual([]);
  });
});
