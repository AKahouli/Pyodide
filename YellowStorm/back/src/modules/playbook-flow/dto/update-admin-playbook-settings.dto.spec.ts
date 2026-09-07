import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateAdminPlaybookSettingsDto } from './update-admin-playbook-settings.dto';

describe('UpdateAdminPlaybookSettingsDto', () => {
  it('accepts a Code Interpreter call limit within bounds', async () => {
    const dto = plainToInstance(UpdateAdminPlaybookSettingsDto, {
      playbookExecution: { maxSandboxCallsPerStep: 16 },
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects a Code Interpreter call limit above the maximum', async () => {
    const dto = plainToInstance(UpdateAdminPlaybookSettingsDto, {
      playbookExecution: { maxSandboxCallsPerStep: 101 },
    });

    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
    expect(errors[0].children?.[0].property).toBe('maxSandboxCallsPerStep');
  });
});
