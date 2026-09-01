import { buildAppShareInviteEmail } from './app-share-invite.email';

describe('buildAppShareInviteEmail', () => {
  it('builds a branded invite with register URL only', () => {
    const result = buildAppShareInviteEmail({
      appTitle: 'Recipe app',
      registerUrl: 'https://apps.example/a/register?invite=token123',
      inviteTtlDays: 7,
    });

    expect(result.subject).toContain('Recipe app');
    expect(result.html).toContain('Recipe app</p>');
    expect(result.html).toContain('has been shared with you.');
    expect(result.html).toContain('href="https://apps.example/a/register?invite=token123"');
    expect(result.html).not.toContain('word-break:break-all');
    expect(result.html).toContain('cid:yellowsys-logo');
    expect(result.html).not.toContain('Open the app');
    expect(result.html).not.toContain('App Builder');
    expect(result.html).toContain('Powered by');
    expect(result.html).toContain('href="https://yellowsys.fr"');
    expect(result.html).toContain('>yellowsys</a>');
    expect(result.text).toBe(
      [
        "You're invited to use Recipe app.",
        '',
        'Create your account: https://apps.example/a/register?invite=token123',
        '',
        'This invitation expires in 7 days.',
        '',
        'Powered by yellowsys — https://yellowsys.fr',
      ].join('\n'),
    );
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]?.cid).toBe('yellowsys-logo');
  });

  it('escapes HTML in app title', () => {
    const result = buildAppShareInviteEmail({
      appTitle: '<script>alert(1)</script>',
      registerUrl: 'https://apps.example/register?invite=x',
      inviteTtlDays: 1,
    });

    expect(result.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(result.html).not.toContain('<script>');
  });
});
