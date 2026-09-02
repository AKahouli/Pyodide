import {
  buildRegistrationPendingAdminEmail,
  buildRegistrationReviewUrl,
} from './registration-pending-admin.email';

describe('registration pending admin email', () => {
  it('includes applicant identity and review links', () => {
    const userId = '64b1f0c2a1b2c3d4e5f60789';
    const approveUrl = buildRegistrationReviewUrl('http://localhost:5173/', userId, 'approve');
    const rejectUrl = buildRegistrationReviewUrl('http://localhost:5173/', userId, 'reject');
    const content = buildRegistrationPendingAdminEmail({
      appName: 'YelloStorm',
      applicantEmail: 'jane@acme.io',
      userId,
      requestedAt: new Date('2026-09-02T12:00:00.000Z'),
      approveUrl,
      rejectUrl,
    });

    expect(approveUrl).toBe(
      `http://localhost:5173/#/admin/users?status=inactive&review=${userId}&decision=approve`,
    );
    expect(rejectUrl).toContain('decision=reject');
    expect(content.subject).toContain('YelloStorm');
    expect(content.html).toContain('jane@acme.io');
    expect(content.html).toContain(userId);
    expect(content.html).toContain('2026-09-02T12:00:00.000Z');
    expect(content.text).toContain(approveUrl);
    expect(content.text).toContain(rejectUrl);
  });

  it('escapes HTML in applicant email', () => {
    const content = buildRegistrationPendingAdminEmail({
      appName: 'YelloStorm',
      applicantEmail: '<script>alert(1)</script>@acme.io',
      userId: 'abc',
      requestedAt: new Date('2026-09-02T12:00:00.000Z'),
      approveUrl: 'http://localhost:5173/#/admin/users?review=abc&decision=approve',
      rejectUrl: 'http://localhost:5173/#/admin/users?review=abc&decision=reject',
    });

    expect(content.html).not.toContain('<script>alert(1)</script>');
    expect(content.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;@acme.io');
  });
});
