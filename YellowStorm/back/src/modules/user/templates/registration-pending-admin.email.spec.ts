import {
  buildAdminUsersUrl,
  buildRegistrationPendingAdminEmail,
  formatRegistrationRequestedAt,
} from './registration-pending-admin.email';

describe('registration pending admin email', () => {
  it('formats requested-at in a readable Europe/Paris datetime', () => {
    expect(formatRegistrationRequestedAt(new Date('2026-09-02T14:21:14.350Z'))).toBe(
      '02/09/2026 à 16:21',
    );
  });

  it('includes applicant email, readable date, and the users admin link', () => {
    const usersAdminUrl = buildAdminUsersUrl('http://localhost:5173/');
    const content = buildRegistrationPendingAdminEmail({
      appName: 'YelloStorm',
      applicantEmail: 'jane@acme.io',
      requestedAt: new Date('2026-09-02T14:21:14.350Z'),
      usersAdminUrl,
    });

    expect(usersAdminUrl).toBe('http://localhost:5173/#/admin/users');
    expect(content.subject).toContain('YelloStorm');
    expect(content.html).toContain('jane@acme.io');
    expect(content.html).toContain('02/09/2026 à 16:21');
    expect(content.html).toContain(usersAdminUrl);
    expect(content.html).not.toContain('User ID');
    expect(content.html).not.toContain('2026-09-02T14:21:14.350Z');
    expect(content.html).not.toContain('decision=approve');
    expect(content.text).toContain(usersAdminUrl);
    expect(content.text).not.toContain('User ID');
  });

  it('escapes HTML in applicant email', () => {
    const content = buildRegistrationPendingAdminEmail({
      appName: 'YelloStorm',
      applicantEmail: '<script>alert(1)</script>@acme.io',
      requestedAt: new Date('2026-09-02T12:00:00.000Z'),
      usersAdminUrl: 'http://localhost:5173/#/admin/users',
    });

    expect(content.html).not.toContain('<script>alert(1)</script>');
    expect(content.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;@acme.io');
  });
});
