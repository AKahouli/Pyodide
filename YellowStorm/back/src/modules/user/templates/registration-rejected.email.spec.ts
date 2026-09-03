import { buildLoginUrl } from './registration-approved.email';
import { buildRegistrationRejectedEmail } from './registration-rejected.email';

describe('registration rejected email', () => {
  it('includes login url, app name, and a solid CTA', () => {
    const loginUrl = buildLoginUrl('http://localhost:5173/');
    const content = buildRegistrationRejectedEmail({
      appName: 'YelloStorm',
      loginUrl,
    });

    expect(content.subject).toBe('Your registration request was declined - YelloStorm');
    expect(content.html).toContain('YelloStorm');
    expect(content.html).toContain('Your access request was declined');
    expect(content.html).toContain(loginUrl);
    expect(content.html).toContain('bgcolor="#667eea"');
    expect(content.html).toContain('background-color: #667eea');
    expect(content.html).toContain('color: #ffffff');
    expect(content.text).toContain('YelloStorm');
    expect(content.text).toContain(loginUrl);
  });

  it('escapes HTML in the app name', () => {
    const content = buildRegistrationRejectedEmail({
      appName: '<script>alert(1)</script>',
      loginUrl: 'http://localhost:5173/#/',
    });

    expect(content.html).not.toContain('<script>alert(1)</script>');
    expect(content.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(content.subject).toContain('<script>alert(1)</script>');
  });
});
