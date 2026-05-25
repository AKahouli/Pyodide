import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { StartPlaybookFlowExecutionDto } from './start-playbook-flow-execution.dto';

describe('StartPlaybookFlowExecutionDto', () => {
  it('accepts valid step execution modes', async () => {
    const dto = plainToInstance(StartPlaybookFlowExecutionDto, {
      stepExecutionModes: {
        'task-1': 'live',
        'task-2': 'replay_flex',
      },
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
  });

  it('rejects invalid step execution modes', async () => {
    const dto = plainToInstance(StartPlaybookFlowExecutionDto, {
      stepExecutionModes: {
        'task-1': 'bad_mode',
      },
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].constraints).toEqual(expect.objectContaining({
      StepExecutionModesConstraint: 'stepExecutionModes contains an invalid execution mode',
    }));
  });

  it('accepts modelIdOverride', async () => {
    const dto = plainToInstance(StartPlaybookFlowExecutionDto, {
      modelIdOverride: 'gpt-4o',
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.modelIdOverride).toBe('gpt-4o');
  });

  it('rejects non-string modelIdOverride', async () => {
    const dto = plainToInstance(StartPlaybookFlowExecutionDto, {
      modelIdOverride: 123,
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('modelIdOverride');
  });
});
