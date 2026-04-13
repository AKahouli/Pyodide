import { ConnectedAppAdminController } from './connected-app-admin.controller';

describe('ConnectedAppAdminController', () => {
  let controller: ConnectedAppAdminController;
  let definitionService: Record<string, jest.Mock>;

  beforeEach(() => {
    definitionService = {
      findAll: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    controller = new ConnectedAppAdminController(definitionService as any);
    jest.clearAllMocks();
  });

  describe('findAll', () => {
    it('should delegate to definitionService.findAll', async () => {
      const mockResult = [{ appKey: 'google-drive', clientId: '****' }];
      definitionService.findAll.mockResolvedValue(mockResult);

      const result = await controller.findAll();

      expect(definitionService.findAll).toHaveBeenCalled();
      expect(result).toEqual(mockResult);
    });
  });

  describe('findById', () => {
    it('should delegate to definitionService.findById with id', async () => {
      const mockResult = { id: 'abc123', appKey: 'google-drive' };
      definitionService.findById.mockResolvedValue(mockResult);

      const result = await controller.findById('abc123');

      expect(definitionService.findById).toHaveBeenCalledWith('abc123');
      expect(result).toEqual(mockResult);
    });
  });

  describe('create', () => {
    it('should delegate to definitionService.create with dto', async () => {
      const dto = { appKey: 'slack', displayName: 'Slack', clientId: 'id', clientSecret: 'secret' };
      const mockResult = { id: 'new-id', appKey: 'slack', clientId: '****' };
      definitionService.create.mockResolvedValue(mockResult);

      const result = await controller.create(dto as any);

      expect(definitionService.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockResult);
    });
  });

  describe('update', () => {
    it('should delegate to definitionService.update with id and dto', async () => {
      const dto = { displayName: 'Updated Name' };
      const mockResult = { id: 'abc123', displayName: 'Updated Name' };
      definitionService.update.mockResolvedValue(mockResult);

      const result = await controller.update('abc123', dto as any);

      expect(definitionService.update).toHaveBeenCalledWith('abc123', dto);
      expect(result).toEqual(mockResult);
    });
  });

  describe('delete', () => {
    it('should delegate to definitionService.delete and return message with count', async () => {
      definitionService.delete.mockResolvedValue({ deletedConnections: 5 });

      const result = await controller.delete('abc123');

      expect(definitionService.delete).toHaveBeenCalledWith('abc123');
      expect(result).toEqual({
        message: 'Connected app deleted successfully',
        deletedConnections: 5,
      });
    });
  });
});
