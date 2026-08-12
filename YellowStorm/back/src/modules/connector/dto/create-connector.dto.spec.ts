import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateConnectorDto } from './create-connector.dto';
import { UpdateConnectorDto } from './update-connector.dto';

describe('Connector hidden visibility DTO', () => {
  it.each([CreateConnectorDto, UpdateConnectorDto])('accepts a boolean isHidden value for %p', async (Dto) => {
    const errors = await validate(plainToInstance(Dto, { isHidden: true }));

    expect(errors.find((error) => error.property === 'isHidden')).toBeUndefined();
  });

  it.each([CreateConnectorDto, UpdateConnectorDto])('rejects a non-boolean isHidden value for %p', async (Dto) => {
    const errors = await validate(plainToInstance(Dto, { isHidden: 'true' }));

    expect(errors.find((error) => error.property === 'isHidden')).toBeDefined();
  });
});
