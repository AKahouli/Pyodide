import axios from 'axios';
import { Readable } from 'node:stream';
import { GuardedUrlDownloaderService } from './guarded-url-downloader.service';
import { publicAddressLookup } from './url-safety';

jest.mock('axios');

it('sends the configured crawler identity and pins the image connection lookup', async () => {
  jest.mocked(axios.get).mockResolvedValue({ status: 200, data: Readable.from([Buffer.from('image')]), headers: {} });
  const downloader = new GuardedUrlDownloaderService({ get: jest.fn(() => 'TestCrawler/1.0') } as never);
  expect((await downloader.download('https://photos.example/japan.png', { maxBytes: 1024, pinDns: true })).data.toString()).toBe('image');
  const options = jest.mocked(axios.get).mock.calls[0][1]!;
  expect(options.headers).toEqual(expect.objectContaining({ 'User-Agent': 'TestCrawler/1.0' }));
  expect(options.proxy).toBe(false);
  expect(options.httpsAgent.options.lookup).toBe(publicAddressLookup);
});
