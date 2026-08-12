import { WorkyPlanningService } from './worky-planning.service';

function svcWithStream(stream: any) {
  const svc = Object.create(WorkyPlanningService.prototype) as WorkyPlanningService;
  // loadStream is private; stub it on the instance for the unit test.
  (svc as any).loadStream = jest.fn().mockResolvedValue(stream);
  return svc;
}

describe('WorkyPlanningService voice prompt', () => {
  it('getVoicePrompt returns the stored value', async () => {
    const svc = svcWithStream({ voicePrompt: 'be terse' });
    await expect(svc.getVoicePrompt('u1', 's1')).resolves.toEqual({ prompt: 'be terse' });
  });

  it('getVoicePrompt returns null when unset', async () => {
    const svc = svcWithStream({ voicePrompt: null });
    await expect(svc.getVoicePrompt('u1', 's1')).resolves.toEqual({ prompt: null });
  });

  it('setVoicePrompt trims and saves a non-empty prompt', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const stream: any = { voicePrompt: null, save };
    const svc = svcWithStream(stream);
    const res = await svc.setVoicePrompt('u1', 's1', '  hello  ');
    expect(stream.voicePrompt).toBe('hello');
    expect(save).toHaveBeenCalled();
    expect(res).toEqual({ prompt: 'hello' });
  });

  it('setVoicePrompt stores null for blank (reset to default)', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const stream: any = { voicePrompt: 'old', save };
    const svc = svcWithStream(stream);
    const res = await svc.setVoicePrompt('u1', 's1', '   ');
    expect(stream.voicePrompt).toBeNull();
    expect(res).toEqual({ prompt: null });
  });
});
