/**
 * Recovers a UTF-8 filename that multer/busboy decoded as latin1.
 *
 * multer (via busboy) decodes the multipart `content-disposition` filename as
 * latin1 by default, so a browser-sent UTF-8 name like `téèôst.pdf` arrives on
 * `file.originalname` as the mojibake `tÃ©Ã¨Ã´st.pdf`. Re-interpreting the
 * latin1 string's bytes as UTF-8 restores the original name.
 *
 * Call this once, at the multipart boundary, before the name is persisted or
 * used. It is safe on names that are already correct: pure-ASCII names
 * round-trip unchanged, names that already contain decoded multibyte
 * characters are left alone, and byte sequences that are not valid UTF-8 fall
 * back to the input (a genuine latin1-only name is preferable to U+FFFD junk).
 */
export function decodeMultipartFilename(name: string): string {
  if (!name) return name;

  // Any char above the latin1 range means the name was already decoded
  // correctly (busboy's latin1 decode only ever yields code points 0-255), so
  // leave it untouched to stay idempotent.
  for (let i = 0; i < name.length; i++) {
    if (name.charCodeAt(i) > 0xff) {
      return name;
    }
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(name, 'latin1'));
  } catch {
    // Not a valid UTF-8 byte sequence (e.g. a real latin1-only name); the
    // original string is the best we have.
    return name;
  }
}
