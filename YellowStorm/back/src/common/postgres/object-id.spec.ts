import { isObjectId, newObjectId, normalizeObjectId } from './object-id';

describe('object-id', () => {
  it('accepts 24-char hex in either case', () => {
    expect(isObjectId('61a1b2c3d4e5f6a7b8c9d0e1')).toBe(true);
    expect(isObjectId('61A1B2C3D4E5F6A7B8C9D0E1')).toBe(true);
  });

  it('rejects wrong length or non-hex', () => {
    expect(isObjectId('61a1b2c3d4e5f6a7b8c9d0e')).toBe(false);
    expect(isObjectId('61a1b2c3d4e5f6a7b8c9d0zz')).toBe(false);
    expect(isObjectId('')).toBe(false);
  });

  it('normalizes to lowercase', () => {
    expect(normalizeObjectId('61A1B2C3D4E5F6A7B8C9D0E1')).toBe('61a1b2c3d4e5f6a7b8c9d0e1');
  });

  it('generates valid lowercase ids', () => {
    const id = newObjectId();
    expect(isObjectId(id)).toBe(true);
    expect(id).toBe(id.toLowerCase());
  });
});
