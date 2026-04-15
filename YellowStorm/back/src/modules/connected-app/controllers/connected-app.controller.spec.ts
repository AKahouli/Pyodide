import { Types } from 'mongoose';
import { ConnectedAppController } from './connected-app.controller';

const userId = new Types.ObjectId();
const mockUser = { _id: userId } as any;

describe('ConnectedAppController', () => {
  let controller: ConnectedAppController;
  let oauthService: Record<string, jest.Mock>;
  let tokenService: Record<string, jest.Mock>;
  let userService: Record<string, jest.Mock>;

  beforeEach(() => {
    oauthService = {
      buildAuthorizationUrl: jest.fn(),
    };
    tokenService = {
      disconnect: jest.fn(),
    };
    userService = {
      getAvailableApps: jest.fn(),
      getUserConnections: jest.fn(),
    };

    controller = new ConnectedAppController(
      oauthService as any,
      tokenService as any,
      userService as any,
    );
    jest.clearAllMocks();
  });

  describe('getAvailableApps', () => {
    it('should delegate to userService.getAvailableApps with userId', async () => {
      const mockApps = [{ appKey: 'google-drive', connected: true }];
      userService.getAvailableApps.mockResolvedValue(mockApps);

      const result = await controller.getAvailableApps(mockUser);

      expect(userService.getAvailableApps).toHaveBeenCalledWith(userId.toString());
      expect(result).toEqual(mockApps);
    });
  });

  describe('getUserConnections', () => {
    it('should delegate to userService.getUserConnections with userId', async () => {
      const mockConnections = [{ appKey: 'google-drive' }];
      userService.getUserConnections.mockResolvedValue(mockConnections);

      const result = await controller.getUserConnections(mockUser);

      expect(userService.getUserConnections).toHaveBeenCalledWith(userId.toString());
      expect(result).toEqual(mockConnections);
    });
  });

  describe('authorize', () => {
    it('should delegate to oauthService.buildAuthorizationUrl and wrap in object', async () => {
      oauthService.buildAuthorizationUrl.mockResolvedValue('https://example.com/auth?state=abc');

      const result = await controller.authorize('google-drive', mockUser);

      expect(oauthService.buildAuthorizationUrl).toHaveBeenCalledWith(
        userId.toString(),
        'google-drive',
      );
      expect(result).toEqual({ authorizationUrl: 'https://example.com/auth?state=abc' });
    });
  });

  describe('disconnect', () => {
    it('should delegate to tokenService.disconnect and return message', async () => {
      tokenService.disconnect.mockResolvedValue(undefined);

      const result = await controller.disconnect('google-drive', mockUser);

      expect(tokenService.disconnect).toHaveBeenCalledWith(userId.toString(), 'google-drive');
      expect(result).toEqual({ message: 'Disconnected successfully' });
    });
  });
});
