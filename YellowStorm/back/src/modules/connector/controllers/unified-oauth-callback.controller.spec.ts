import { UnifiedOAuthCallbackController } from './unified-oauth-callback.controller';

describe('UnifiedOAuthCallbackController', () => {
  let userStore: { exists: jest.Mock };
  let adminStore: { exists: jest.Mock };
  let userService: { handleCallback: jest.Mock; buildCallbackHtml: jest.Mock };
  let adminService: { handleCallback: jest.Mock; buildCallbackHtml: jest.Mock };
  let controller: UnifiedOAuthCallbackController;
  let res: { send: jest.Mock };

  beforeEach(() => {
    userStore = { exists: jest.fn().mockResolvedValue(false) };
    adminStore = { exists: jest.fn().mockResolvedValue(false) };
    userService = { handleCallback: jest.fn().mockResolvedValue(undefined), buildCallbackHtml: jest.fn().mockReturnValue('USER_HTML') };
    adminService = {
      handleCallback: jest.fn().mockResolvedValue({ appKey: 'app', success: true }),
      buildCallbackHtml: jest.fn().mockReturnValue('ADMIN_HTML'),
    };
    const logger = { setContext: jest.fn(), error: jest.fn() };
    controller = new UnifiedOAuthCallbackController(
      userStore as never, adminStore as never, userService as never, adminService as never, logger as never,
    );
    res = { send: jest.fn() };
  });

  it('routes to the user flow when the state exists in the user state table (admin table not consulted)', async () => {
    userStore.exists.mockResolvedValue(true);
    await controller.unifiedCallback('app', 'code', 'st', '', res as never);
    expect(userStore.exists).toHaveBeenCalledWith('st');
    expect(adminStore.exists).not.toHaveBeenCalled();
    expect(userService.handleCallback).toHaveBeenCalledWith('app', 'code', 'st');
    expect(adminService.handleCallback).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith('USER_HTML');
  });

  it('routes to the admin flow when only the admin state table has the state', async () => {
    adminStore.exists.mockResolvedValue(true);
    await controller.unifiedCallback('app', 'code', 'st', '', res as never);
    expect(adminService.handleCallback).toHaveBeenCalledWith('app', 'code', 'st');
    expect(userService.handleCallback).not.toHaveBeenCalled();
    expect(res.send).toHaveBeenCalledWith('ADMIN_HTML');
  });

  it('answers invalid_state when neither table knows the state', async () => {
    await controller.unifiedCallback('app', 'code', 'st', '', res as never);
    expect(userService.handleCallback).not.toHaveBeenCalled();
    expect(adminService.handleCallback).not.toHaveBeenCalled();
    expect(res.send.mock.calls[0][0]).toContain('invalid_state');
  });

  it('short-circuits on provider error and missing params without touching the stores', async () => {
    await controller.unifiedCallback('app', 'c', 's', 'access_denied', res as never);
    expect(res.send.mock.calls[0][0]).toContain('access_denied');
    await controller.unifiedCallback('app', '', 's', '', res as never);
    expect(res.send.mock.calls[1][0]).toContain('missing_params');
    expect(userStore.exists).not.toHaveBeenCalled();
  });

  it('turns a service failure into an error page instead of throwing', async () => {
    userStore.exists.mockResolvedValue(true);
    userService.handleCallback.mockRejectedValue(new Error('exchange failed'));
    await expect(controller.unifiedCallback('app', 'code', 'st', '', res as never)).resolves.toBeUndefined();
    expect(res.send.mock.calls[0][0]).toContain('exchange failed');
  });

  it('never reflects raw markup from the provider error / appKey into the HTML page', async () => {
    await controller.unifiedCallback("a'</script><b>", 'c', 's', '<script>alert(1)</script>', res as never);
    const html: string = res.send.mock.calls[0][0];
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('</script><b>');
  });
});
