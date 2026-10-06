import { BadRequestException } from '../../exceptions';
import { RootPolicyService } from './root-policy.service';
import { newRootExecutionPolicy, enrollLegacyRootPolicy } from '../interfaces/root-execution-policy.interface';

describe('RootPolicyService', () => {
  const agentRepository = { findByIds: jest.fn() };
  const teamService = { findTeamBasicById: jest.fn() };
  const service = new RootPolicyService(agentRepository as never, teamService as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('eligibility', () => {
    it('accepts only the mono-agent slug', () => {
      expect(service.isEligibleRootType('mono-agent')).toBe(true);
      expect(service.isEligibleRootType('Mono_Agent')).toBe(true);
      expect(service.isEligibleRootType('humain')).toBe(false);
      expect(() => { service.requireEligibleRootType('humain'); }).toThrow(BadRequestException);
    });
  });

  describe('normalizePolicy', () => {
    it('gives new roots the default-on temporary workers and disabled fanout/background', () => {
      const policy = service.normalizePolicy({ version: 1 } as never, {
        isNewRoot: true,
        legacyTemporaryChildEnabled: false,
      });
      expect(policy).toEqual(newRootExecutionPolicy());
      expect(policy!.temporaryWorkers.enabled).toBe(true);
      expect(policy!.fanout.enabled).toBe(false);
      expect(policy!.background.enabled).toBe(false);
      expect(policy!.limits.maxDepth).toBe(1);
    });

    it('enrollment preserves a legacy temporary-worker opt-out (A25)', () => {
      const policy = service.normalizePolicy({ version: 1 } as never, {
        isNewRoot: false,
        legacyTemporaryChildEnabled: false,
      });
      expect(policy!.temporaryWorkers.enabled).toBe(false);
      expect(policy).toEqual(enrollLegacyRootPolicy(false));
    });

    it('merges partial sections over the stored policy without dropping siblings', () => {
      const existing = newRootExecutionPolicy();
      existing.fanout.enabled = true;
      const policy = service.normalizePolicy(
        { version: 1, delegation: { enabled: true, defaultConfigurationMode: 'root_constrained' } } as never,
        { isNewRoot: false, legacyTemporaryChildEnabled: true, existing },
      );
      expect(policy!.delegation.defaultConfigurationMode).toBe('root_constrained');
      expect(policy!.fanout.enabled).toBe(true);
      expect(policy!.temporaryWorkers).toEqual(existing.temporaryWorkers);
    });

    it('null payload un-enrolls', () => {
      expect(service.normalizePolicy(null, { isNewRoot: false, legacyTemporaryChildEnabled: true })).toBeNull();
    });
  });

  describe('validateAllowlist', () => {
    it('rejects self-delegation and malformed ids without touching the repository', async () => {
      await expect(service.validateAllowlist('a'.repeat(24), ['a'.repeat(24)], []))
        .rejects.toThrow(BadRequestException);
      await expect(service.validateAllowlist('b'.repeat(24), ['nope'], []))
        .rejects.toThrow(BadRequestException);
      expect(agentRepository.findByIds).not.toHaveBeenCalled();
    });

    it('rejects delegates that are missing or inactive', async () => {
      agentRepository.findByIds.mockResolvedValue([]);
      await expect(service.validateAllowlist('b'.repeat(24), ['c'.repeat(24)], []))
        .rejects.toThrow(BadRequestException);
    });

    it('accepts existing active delegates and active teams', async () => {
      agentRepository.findByIds.mockResolvedValue([{ _id: 'c'.repeat(24) }]);
      teamService.findTeamBasicById.mockResolvedValue({ id: 'd'.repeat(24), isActive: true });
      await expect(
        service.validateAllowlist('b'.repeat(24), ['c'.repeat(24)], ['d'.repeat(24)]),
      ).resolves.toBeUndefined();
    });

    it('rejects inactive or missing teams', async () => {
      agentRepository.findByIds.mockResolvedValue([{ _id: 'c'.repeat(24) }]);
      teamService.findTeamBasicById.mockResolvedValue({ id: 'd'.repeat(24), isActive: false });
      await expect(
        service.validateAllowlist('b'.repeat(24), ['c'.repeat(24)], ['d'.repeat(24)]),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
