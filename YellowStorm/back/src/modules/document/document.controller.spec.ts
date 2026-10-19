import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DocumentModule } from './document.module';
import { DocumentService } from './document.service';
import { DocumentConnectionService } from './document-connection.service';

describe('R02 removed arbitrary-key presign route', () => {
  let app: INestApplication;
  const signer = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [DocumentModule] })
      .overrideProvider(DocumentService).useValue({ generateSasUrl: signer })
      .overrideProvider(DocumentConnectionService).useValue({})
      .compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
  });

  afterAll(async () => { await app?.close(); });

  it.each<Record<string, string>>([
    {},
    { 'X-Internal-Token': 'synthetic-legacy-key' },
    { 'X-YellowStorm-Service-Principal': 'mcp-agent', 'X-YellowStorm-Service-Token': 'synthetic-agent-key' },
    { 'X-YellowStorm-Service-Principal': 'semantic-model-mcp', 'X-YellowStorm-Service-Token': 'synthetic-semantic-key' },
  ])('has no raw-key signing surface regardless of credential headers', async (headers) => {
    const response = await fetch(`${await app.getUrl()}/api/v1/internal/documents/download-url`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: 'synthetic-foreign/object.pdf', expiryMinutes: 1440 }),
    });
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).not.toHaveProperty('url');
    expect(body).not.toHaveProperty('downloadUrl');
    expect(signer).not.toHaveBeenCalled();
  });
});
