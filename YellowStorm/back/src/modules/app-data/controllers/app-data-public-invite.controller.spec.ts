import { ConfigService } from '@nestjs/config';
import { AppDataEndUserAuthService } from '../services/app-data-end-user-auth.service';
import { AppDataPublicInviteController } from './app-data-public-invite.controller';
import { AppDataErrorCode, AppDataException } from '../constants/app-data.errors';
import { HttpStatus } from '@nestjs/common';

describe('AppDataPublicInviteController', () => {
  const config = {
    get: jest.fn().mockReturnValue(true),
  };
  const auth = {
    resolveInvite: jest.fn(),
  };
  const ctrl = new AppDataPublicInviteController(
    config as unknown as ConfigService,
    auth as unknown as AppDataEndUserAuthService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    config.get.mockReturnValue(true);
  });

  it('resolves a live invite', async () => {
    auth.resolveInvite.mockResolvedValue({
      email: 'guest@example.com',
      appTitle: 'App',
      expiresAt: '2026-09-08T00:00:00.000Z',
    });
    await expect(ctrl.resolve('ad-1', 'tok')).resolves.toEqual({
      email: 'guest@example.com',
      appTitle: 'App',
      expiresAt: '2026-09-08T00:00:00.000Z',
    });
    expect(auth.resolveInvite).toHaveBeenCalledWith('ad-1', 'tok');
  });

  it('maps missing tokens through the auth service', async () => {
    auth.resolveInvite.mockResolvedValue({ email: 'a@b.c', appTitle: 'App', expiresAt: 't' });
    await ctrl.resolve('ad-1', undefined);
    expect(auth.resolveInvite).toHaveBeenCalledWith('ad-1', '');
  });

  it('propagates 404 / 410 from resolveInvite', async () => {
    auth.resolveInvite.mockRejectedValue(
      new AppDataException(AppDataErrorCode.INVITE_INVALID, 'invalid', HttpStatus.NOT_FOUND),
    );
    await expect(ctrl.resolve('ad-1', 'bad')).rejects.toMatchObject({
      appDataCode: AppDataErrorCode.INVITE_INVALID,
      status: HttpStatus.NOT_FOUND,
    });

    auth.resolveInvite.mockRejectedValue(
      new AppDataException(AppDataErrorCode.INVITE_EXPIRED, 'expired', HttpStatus.GONE),
    );
    await expect(ctrl.resolve('ad-1', 'old')).rejects.toMatchObject({
      appDataCode: AppDataErrorCode.INVITE_EXPIRED,
      status: HttpStatus.GONE,
    });
  });
});
