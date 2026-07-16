import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SearchUsersDto } from './search-users.dto';

describe('SearchUsersDto', () => {
  it.each(['   ', '  a', 'ab '])('rejects a query shorter than three characters after trimming: %p', async (q) => {
    const dto = plainToInstance(SearchUsersDto, { q, limit: 10 });

    expect(await validate(dto)).not.toHaveLength(0);
  });

  it('trims and accepts a three-character query', async () => {
    const dto = plainToInstance(SearchUsersDto, { q: '  ala  ', limit: 10 });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.q).toBe('ala');
  });
});
