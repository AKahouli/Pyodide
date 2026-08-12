import { redactTaskDiagnosticText, sanitizeTaskDiagnosticItems } from './task-diagnostics';

describe('task diagnostics sanitization', () => {
  it('redacts common credential forms', () => {
    const sanitized = redactTaskDiagnosticText(
      'token=one refresh_token=two id_token=three API key=six access token=seven client secret=eight connection string=nine\nAuthorization: Basic dXNlcjpwYXNz\nCookie: session=four\nhttps://user:five@example.com',
    );

    expect(sanitized).not.toMatch(/one|two|three|six|seven|eight|nine|dXNlcjpwYXNz|session=four|user:five/);
    expect(sanitized).toContain('token=[REDACTED]');
    expect(sanitized).toContain('Authorization: [REDACTED]');
    expect(sanitized).toContain('Cookie: [REDACTED]');
    expect(sanitized).toContain('https://user:[REDACTED]@example.com');
  });

  it('bounds diagnostic item count and length', () => {
    const sanitized = sanitizeTaskDiagnosticItems(Array.from({ length: 25 }, (_, index) => `${index}:${'x'.repeat(31_000)}`));

    expect(sanitized).toHaveLength(20);
    expect(sanitized[0].length).toBe(30_000);
  });
});
