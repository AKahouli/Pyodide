/**
 * Normalizes public API row payloads. Supports optional `{ row: ... }` / `{ data: ... }`
 * wrappers and bypasses ValidationPipe stripping on dynamic column keys.
 *
 * When the request arrives without `Content-Type: application/json`, Express won't
 * parse the body and `req.body` will be `undefined`. We detect that and throw a clear
 * error instead of silently returning `{}`.
 */
export function normalizeAppDataRowBody(
  body: unknown,
  contentType?: string,
): Record<string, unknown> {
  if (body === undefined || body === null) {
    if (contentType && !contentType.includes('application/json')) {
      throw new Error(
        `App Data requires Content-Type: application/json, but received "${contentType}". ` +
          'Set headers: { "Content-Type": "application/json" } on the fetch/POST call.',
      );
    }
    throw new Error(
      'App Data received an empty body. Ensure the request sets Content-Type: application/json ' +
        'and sends a JSON-stringified object with column keys matching the schema.',
    );
  }

  if (typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }

  const record = body as Record<string, unknown>;
  const nested = record.row ?? record.data;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return omitUndefined(nested as Record<string, unknown>);
  }

  return omitUndefined(record);
}

function omitUndefined(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}
