import { Types } from 'mongoose';
import { ConnectorService } from './connector.service';

describe('ConnectorService importFromMcp', () => {
  it('creates a new connector with a unique slug when the imported name already exists', async () => {
    const create = jest.fn().mockResolvedValue({});
    const find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            { slug: 'sharepoint', name: 'SharePoint' },
            { slug: 'sharepoint-2', name: 'SharePoint (2)' },
          ]),
        }),
      }),
    });
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };

    const service = new ConnectorService(
      {
        create,
        find,
      } as any,
      logger as any,
    );

    jest.spyOn(service, 'inspectMcp').mockResolvedValue({
      serverName: 'SharePoint',
      tools: [
        {
          name: 'list_files',
          description: 'List files',
          inputSchema: { type: 'object' },
        },
      ],
    });

    const createdBy = new Types.ObjectId().toString();
    const result = await service.importFromMcp(createdBy, 'streamable_http', 'https://example.com/mcp');

    expect(result.error).toBeUndefined();
    expect(find).toHaveBeenCalled();
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'sharepoint-3',
        name: 'SharePoint (3)',
        mcpTransportType: 'streamable_http',
        mcpServerUrl: 'https://example.com/mcp',
        isActive: true,
      }),
    );
  });

  it('keeps the original name and slug for the first import', async () => {
    const create = jest.fn().mockResolvedValue({});
    const find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      }),
    });
    const logger = {
      setContext: jest.fn(),
      log: jest.fn(),
      error: jest.fn(),
    };

    const service = new ConnectorService(
      {
        create,
        find,
      } as any,
      logger as any,
    );

    jest.spyOn(service, 'inspectMcp').mockResolvedValue({
      serverName: 'SharePoint',
      tools: [],
    });

    await service.importFromMcp(new Types.ObjectId().toString(), 'streamable_http', 'https://example.com/mcp');

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'sharepoint',
        name: 'SharePoint',
      }),
    );
  });
});
