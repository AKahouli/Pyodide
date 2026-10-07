import { RootBackgroundInputService } from './root-background-input.service';

describe('Background input owner boundary', () => {
  it('reauthorizes current producer resources before queueing human approval', async () => {
    const jobs = { queueInputs: jest.fn().mockResolvedValue({ status: 'queued' }) };
    const results = { authorizeBackgroundExecution: jest.fn().mockRejectedValueOnce(new Error('revoked')).mockResolvedValue({}) };
    const service = new RootBackgroundInputService(jobs as any, results as any);
    const input = [{ inputId: 'call', inputVersion: 2, response: { confirmed: false } }];
    await expect(service.submit('conversation', 'job', 'actor', input)).rejects.toThrow('revoked');
    expect(jobs.queueInputs).not.toHaveBeenCalled();
    expect(await service.submit('conversation', 'job', 'actor', input)).toEqual({ status: 'queued' });
    expect(jobs.queueInputs).toHaveBeenCalledWith('conversation', 'job', 'actor', input);
  });
});
