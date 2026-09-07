import { Readable, Writable } from 'stream';
import { PlaybookFlowArtifactController } from './playbook-flow-artifact.controller';
import { RATE_LIMIT_KEY } from '@modules/rate-limiter/decorators/rate-limit.decorator';

describe('PlaybookFlowArtifactController', () => {
  it('streams capability content with action-derived headers and no redirect', async () => {
    const artifactService = {
      openContent: jest.fn().mockResolvedValue({
        action: 'download',
        filename: 'report.pdf',
        mimeType: 'application/pdf',
        stream: {
          body: Readable.from(['content']),
          contentType: 'application/pdf',
          contentLength: 7,
          acceptRanges: 'bytes',
        },
      }),
    };
    const chunks: Buffer[] = [];
    const response = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
    }) as Writable & Record<string, any>;
    response.status = jest.fn().mockReturnValue(response);
    response.setHeader = jest.fn();
    response.on = Writable.prototype.on.bind(response);

    await new PlaybookFlowArtifactController(artifactService as any).content('token', undefined, response as any);

    expect(artifactService.openContent).toHaveBeenCalledWith('token', undefined);
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.setHeader).toHaveBeenCalledWith('Content-Disposition', "attachment; filename*=UTF-8''report.pdf");
    expect(response.setHeader).not.toHaveBeenCalledWith('Location', expect.anything());
    expect(Buffer.concat(chunks).toString()).toBe('content');
  });

  it('declares an explicit rate limit for the public capability route', () => {
    const metadata = Reflect.getMetadata(RATE_LIMIT_KEY, PlaybookFlowArtifactController.prototype.content);
    expect(metadata).toEqual(expect.objectContaining({ limit: 120, windowMs: 60000 }));
  });

  it('does not propagate a stream error after response bytes have started', async () => {
    const body = new Readable({
      read() {
        this.push('partial');
        this.destroy(new Error('storage interrupted'));
      },
    });
    const artifactService = {
      openContent: jest.fn().mockResolvedValue({
        action: 'view', filename: 'report.pdf', mimeType: 'application/pdf', stream: { body },
      }),
    };
    const response = new Writable({ write(_chunk, _encoding, callback) { callback(); } }) as Writable & Record<string, any>;
    response.status = jest.fn().mockReturnValue(response);
    response.setHeader = jest.fn();
    Object.defineProperty(response, 'headersSent', { value: true });

    await expect(new PlaybookFlowArtifactController(artifactService as any).content('token', undefined, response as any)).resolves.toBeUndefined();
    expect(response.destroyed).toBe(true);
  });
});
