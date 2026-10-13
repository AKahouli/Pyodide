/** SHA-256 hex digest, matching the backend's `hashlib.sha256(...).hexdigest()`. */
export async function sha256(content: string | Uint8Array): Promise<string> {
  const bytes =
    typeof content === 'string' ? new TextEncoder().encode(content) : content;
  // `digest` wants an ArrayBuffer view backed by a plain ArrayBuffer.
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
