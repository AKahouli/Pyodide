import { PlaybookFlowOutputContractService } from './playbook-flow-output-contract.service';
import { FlowReplayOutputContractType } from '../schemas/playbook-flow-validated-replay.schema';

describe('PlaybookFlowOutputContractService', () => {
  let service: PlaybookFlowOutputContractService;

  beforeEach(() => {
    service = new PlaybookFlowOutputContractService();
  });

  it('passes shallow json contract validation for semantic variants', () => {
    const contract = service.buildOutputContractFromReplay({
      output: { summary: 'ok', score: 1 },
      preserveOutputFormat: true,
      outputFormatGuide: null,
      existingOutputContract: null,
    });

    const result = service.validateOutputContract({
      output: { summary: 'different wording', score: 2 },
      outputContract: contract,
    });

    expect(contract?.type).toBe(FlowReplayOutputContractType.JSON_SCHEMA);
    expect(result).toEqual({
      evaluated: true,
      passed: true,
      score: 100,
      reasons: [],
    });
  });

  it('fails json contract validation when required keys are missing', () => {
    const contract = service.buildOutputContractFromReplay({
      output: { summary: 'ok', score: 1 },
      preserveOutputFormat: true,
      outputFormatGuide: null,
      existingOutputContract: null,
    });

    const result = service.validateOutputContract({
      output: { summary: 'only one field' },
      outputContract: contract,
    });

    expect(result.evaluated).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('missing_required_key:score');
  });

  it('enforces markdown required and forbidden sections', () => {
    const result = service.validateOutputContract({
      output: '# Summary\nHello\n## Notes\nKeep',
      outputContract: {
        type: FlowReplayOutputContractType.MARKDOWN_SECTIONS,
        requiredSections: ['Summary', 'Risks'],
        forbiddenSections: ['Notes'],
        jsonSchema: null,
        citationPolicy: 'optional',
      },
    });

    expect(result.evaluated).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.reasons).toEqual(expect.arrayContaining([
      'missing_required_section:Risks',
      'forbidden_section_present:Notes',
    ]));
  });

  it('requires citations when the contract says so', () => {
    const result = service.validateOutputContract({
      output: '# Summary\nNo references here',
      outputContract: {
        type: FlowReplayOutputContractType.FREEFORM,
        requiredSections: [],
        forbiddenSections: [],
        jsonSchema: null,
        citationPolicy: 'required',
      },
    });

    expect(result.evaluated).toBe(true);
    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('citation_required');
  });

  it('drops legacy json schema preservation when preserveOutputFormat is disabled', () => {
    const contract = service.buildOutputContractFromReplay({
      output: '{"summary":"ok"}',
      preserveOutputFormat: false,
      outputFormatGuide: null,
      existingOutputContract: {
        type: FlowReplayOutputContractType.JSON_SCHEMA,
        requiredSections: [],
        forbiddenSections: [],
        jsonSchema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
        citationPolicy: 'optional',
      },
    });

    expect(contract).toBeNull();
  });

  it('does not require citations from baseline text alone', () => {
    const contract = service.buildOutputContractFromReplay({
      output: '# Sources\nInternal docs',
      preserveOutputFormat: false,
      outputFormatGuide: null,
      existingOutputContract: null,
    });

    expect(contract).toEqual(expect.objectContaining({
      type: FlowReplayOutputContractType.MARKDOWN_SECTIONS,
      citationPolicy: 'optional',
    }));
  });

  it('marks citations forbidden when the guide explicitly bans them', () => {
    const contract = service.buildOutputContractFromReplay({
      output: '# Summary\nHello',
      preserveOutputFormat: false,
      outputFormatGuide: 'Write the answer without citations or references.',
      existingOutputContract: null,
    });

    expect(contract).toEqual(expect.objectContaining({ citationPolicy: 'forbidden' }));
  });
});
