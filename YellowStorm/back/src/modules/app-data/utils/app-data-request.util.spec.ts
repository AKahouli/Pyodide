import {
  parseAppDataEnvironment,
  parsePositiveInt,
} from './app-data-request.util';
import { AppDataErrorCode, AppDataException } from '../constants/app-data.errors';

describe('app-data-request.util', () => {
  it('parses finite page numbers and rejects NaN/Infinity', () => {
    expect(parsePositiveInt('2', 1)).toBe(2);
    expect(parsePositiveInt('NaN', 7)).toBe(7);
    expect(parsePositiveInt('Infinity', 7)).toBe(7);
    expect(parsePositiveInt(0, 3)).toBe(3);
    expect(parsePositiveInt(-4, 3)).toBe(3);
    expect(parsePositiveInt(undefined, 9)).toBe(9);
  });

  it('accepts only dev and prod environments', () => {
    expect(parseAppDataEnvironment('dev')).toBe('dev');
    expect(parseAppDataEnvironment('prod')).toBe('prod');
    try {
      parseAppDataEnvironment('staging');
      fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(AppDataException);
      expect((err as AppDataException).appDataCode).toBe(AppDataErrorCode.INVALID_MANIFEST);
    }
  });
});
