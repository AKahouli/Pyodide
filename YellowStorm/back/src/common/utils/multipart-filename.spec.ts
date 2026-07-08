import { decodeMultipartFilename } from './multipart-filename';

describe('decodeMultipartFilename', () => {
  it('recovers a UTF-8 filename that multer decoded as latin1 (mojibake)', () => {
    const original = 'téèôst.pdf';
    // What multer/busboy hands us: UTF-8 bytes decoded as latin1.
    const mojibake = Buffer.from(original, 'utf8').toString('latin1');
    expect(mojibake).toBe('tÃ©Ã¨Ã´st.pdf');
    expect(decodeMultipartFilename(mojibake)).toBe(original);
  });

  it('leaves a plain ASCII filename unchanged', () => {
    expect(decodeMultipartFilename('report_2026.pdf')).toBe('report_2026.pdf');
  });

  it('recovers other scripts (e.g. accents, emoji, CJK)', () => {
    for (const original of ['résumé.docx', 'café ☕.txt', '契約書.pdf', 'Über.md']) {
      const mojibake = Buffer.from(original, 'utf8').toString('latin1');
      expect(decodeMultipartFilename(mojibake)).toBe(original);
    }
  });

  it('is idempotent (already-decoded names are not corrupted a second time)', () => {
    const original = 'téèôst.pdf';
    const once = decodeMultipartFilename(Buffer.from(original, 'utf8').toString('latin1'));
    expect(decodeMultipartFilename(once)).toBe(original);
  });

  it('falls back to the input when the bytes are not valid UTF-8', () => {
    // A lone latin1 byte that is not valid UTF-8 must not become U+FFFD garbage.
    const latin1Only = 'facturé\xA0.pdf'; // 0xA0 = non-breaking space, invalid as utf8 lead
    expect(decodeMultipartFilename(latin1Only)).toBe(latin1Only);
  });

  it('handles empty and nullish input safely', () => {
    expect(decodeMultipartFilename('')).toBe('');
    expect(decodeMultipartFilename(undefined as unknown as string)).toBe(undefined);
    expect(decodeMultipartFilename(null as unknown as string)).toBe(null);
  });
});
