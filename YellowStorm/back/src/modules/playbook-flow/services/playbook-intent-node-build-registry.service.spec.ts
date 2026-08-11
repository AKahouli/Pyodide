import { PlaybookIntentNodeBuildRegistryService } from './playbook-intent-node-build-registry.service';

describe('PlaybookIntentNodeBuildRegistryService', () => {
  let service: PlaybookIntentNodeBuildRegistryService;

  beforeEach(() => {
    service = new PlaybookIntentNodeBuildRegistryService();
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  });

  it.each([
    ['agent', 'step'],
    ['action', 'step'],
    ['evaluation', 'step'],
    ['iterator', 'iterator'],
    ['router', 'router'],
    ['human_approval', 'human_approval'],
  ] as const)('maps blueprint kind "%s" to runtime kind "%s"', (input, expected) => {
    expect(service.resolveRuntimeKind(input)).toBe(expected);
  });

  it('returns a step descriptor for unsupported kinds and logs a warning', () => {
    const descriptor = service.describe('future_kind' as any);
    expect(descriptor.runtimeKind).toBe('step');
    expect((service as any).logger.warn).toHaveBeenCalledWith(expect.stringContaining('future_kind'));
  });

  it('falls back to the default descriptor for missing blueprint kind hints', () => {
    const descriptor = service.describe(null);
    expect(descriptor.runtimeKind).toBe('step');
  });

  it('exposes every supported blueprint node kind', () => {
    expect(service.supportedKinds().sort()).toEqual(
      ['action', 'agent', 'evaluation', 'human_approval', 'iterator', 'router'].sort(),
    );
  });
});
