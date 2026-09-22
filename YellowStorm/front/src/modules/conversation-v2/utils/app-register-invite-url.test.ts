import { describe, expect, it } from 'vitest';
import { buildAppRegisterInviteUrl } from './app-register-invite-url';

describe('buildAppRegisterInviteUrl', () => {
  it('appends register without creating a double slash when base ends with /', () => {
    expect(
      buildAppRegisterInviteUrl(
        'https://apps.yellowsys.org/apps/ecd0e47b8abb4ece/',
        'TOKEN',
      ),
    ).toBe('https://apps.yellowsys.org/apps/ecd0e47b8abb4ece/register?invite=TOKEN');
  });

  it('adds a single slash when base has no trailing slash', () => {
    expect(
      buildAppRegisterInviteUrl('https://apps.yellowsys.org/apps/ecd0e47b8abb4ece', 'TOKEN'),
    ).toBe('https://apps.yellowsys.org/apps/ecd0e47b8abb4ece/register?invite=TOKEN');
  });

  it('collapses multiple trailing slashes', () => {
    expect(
      buildAppRegisterInviteUrl('https://apps.yellowsys.org/apps/ecd0e47b8abb4ece///', 'TOKEN'),
    ).toBe('https://apps.yellowsys.org/apps/ecd0e47b8abb4ece/register?invite=TOKEN');
  });
});
