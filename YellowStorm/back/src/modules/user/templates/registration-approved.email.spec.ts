import {
  buildLoginUrl,
  buildRegistrationApprovedEmail,
} from './registration-approved.email';

describe('registration approved email', () => {
  it('includes login url and app name', () => {
    const loginUrl = buildLoginUrl('http://localhost:5173/');
    const content = buildRegistrationApprovedEmail({
      appName: 'YelloStorm',
      loginUrl,
    });

    expect(loginUrl).toBe('http://localhost:5173/#/');
    expect(content.subject).toContain('YelloStorm');
    expect(content.html).toContain(loginUrl);
    expect(content.html).toContain('Your account is now active');
    expect(content.text).toContain(loginUrl);
  });

  it('escapes HTML in the app name', () => {
    const content = buildRegistrationApprovedEmail({
      appName: '<script>alert(1)</script>',
      loginUrl: 'http://localhost:5173/#/',
    });

    expect(content.html).not.toContain('<script>alert(1)</script>');
    expect(content.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(content.subject).toContain('<script>alert(1)</script>');
  });
});
