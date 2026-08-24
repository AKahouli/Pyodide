import { PlaybookTokenStreamRedactor, publicPlaybookTaskResult, trustedPlaybookArtifacts } from './playbook-artifact';

const taskResult = {
  taskId: 'generate-pdf',
  iteration: 0,
  output: 'Saved at /mnt/workspace/private/ai_brief.pdf',
  artifacts: [{ filename: 'ai_brief.pdf', url: '/mnt/workspace/private/ai_brief.pdf', filepath: '/mnt/workspace/private/ai_brief.pdf' }],
  components: [{
    type: 'artifact',
    data: {
      filename: 'ai_brief.pdf',
      file_path: 'owner-1/system_execution-1/ai_brief.pdf',
      object_key: 'owner-1/system_execution-1/ai_brief.pdf',
      artifact_kind: 'document',
    },
  }],
};

describe('playbook artifact projection', () => {
  it('projects canonical storage artifacts to opaque public metadata', () => {
    const artifactId = trustedPlaybookArtifacts(taskResult, 'owner-1', 'execution-1')[0].artifactId;
    const projected = publicPlaybookTaskResult(taskResult, 'owner-1', 'execution-1', new Set([artifactId]));
    const artifact = (projected.artifacts as Array<Record<string, unknown>>)[0];
    const component = (projected.components as Array<Record<string, any>>)[0];

    expect(artifact.artifactId).toMatch(/^[a-f0-9]{32}$/);
    expect(artifact).not.toHaveProperty('url');
    expect(artifact).not.toHaveProperty('filepath');
    expect(component.data.artifactId).toBe(artifact.artifactId);
    expect(component.data).not.toHaveProperty('file_path');
    expect(component.data).not.toHaveProperty('object_key');
    expect(projected.output).not.toContain('/mnt/workspace');
  });

  it('derives storage paths for backend-published opaque artifacts', () => {
    const published = {
      taskId: 'generate-pdf',
      iteration: 0,
      components: [{
        type: 'artifact',
        data: {
          artifactId: 'a'.repeat(32),
          filename: 'report.pdf',
          mime_type: 'application/pdf',
        },
      }],
    };

    const [artifact] = trustedPlaybookArtifacts(published, 'owner-1', 'execution-1');
    expect(artifact).toEqual(expect.objectContaining({
      artifactId: 'a'.repeat(32),
      storagePath: `owner-1/system_execution-1/artifacts/${'a'.repeat(32)}`,
      filename: 'report.pdf',
      mimeType: 'application/pdf',
    }));
  });

  it('rejects runtime-controlled artifact IDs that are not publication receipts', () => {
    const forged = structuredClone(taskResult);
    forged.components[0].data = {
      filename: 'ai_brief.pdf',
      artifact_kind: 'document',
      artifactId: 'runtime-controlled-id',
    } as any;

    expect(trustedPlaybookArtifacts(forged, 'owner-1', 'execution-1')).toEqual([]);
  });

  it('does not trust storage paths outside the execution workspace', () => {
    const foreign = structuredClone(taskResult);
    foreign.components[0].data.file_path = 'another-owner/system_execution-1/private.pdf';
    foreign.components[0].data.object_key = 'another-owner/system_execution-1/private.pdf';

    expect(trustedPlaybookArtifacts(foreign, 'owner-1', 'execution-1')).toEqual([]);
    expect((publicPlaybookTaskResult(foreign, 'owner-1', 'execution-1').artifacts as Array<Record<string, unknown>>)[0]).not.toHaveProperty('artifactId');
  });

  it('associates duplicate filenames with their source components one-to-one', () => {
    const duplicate = structuredClone(taskResult);
    duplicate.components.push({
      type: 'artifact',
      data: {
        filename: 'ai_brief.pdf',
        file_path: 'owner-1/system_execution-1/revised/ai_brief.pdf',
        object_key: 'owner-1/system_execution-1/revised/ai_brief.pdf',
        artifact_kind: 'document',
      },
    });
    duplicate.artifacts.push({ filename: 'ai_brief.pdf', url: '/mnt/workspace/private/revised/ai_brief.pdf', filepath: '/mnt/workspace/private/revised/ai_brief.pdf' });

    const verifiedIds = new Set(trustedPlaybookArtifacts(duplicate, 'owner-1', 'execution-1').map((artifact) => artifact.artifactId));
    const projected = publicPlaybookTaskResult(duplicate, 'owner-1', 'execution-1', verifiedIds);
    const componentIds = (projected.components as Array<Record<string, any>>).map((component) => component.data.artifactId);
    const artifactIds = (projected.artifacts as Array<Record<string, unknown>>).map((artifact) => artifact.artifactId);

    expect(new Set(componentIds).size).toBe(2);
    expect(artifactIds).toEqual(componentIds);
  });

  it('withholds actions and runtime readiness until storage is verified', () => {
    const unverified = structuredClone(taskResult);
    unverified.artifacts[0] = {
      ...unverified.artifacts[0],
      artifact_id: 'runtime-controlled-id',
      availability: 'ready',
    } as unknown as typeof unverified.artifacts[0];
    unverified.components[0].data = {
      ...unverified.components[0].data,
      artifactId: 'runtime-controlled-id',
      availability: 'ready',
    } as unknown as typeof unverified.components[0]['data'];

    const projected = publicPlaybookTaskResult(unverified, 'owner-1', 'execution-1');
    const artifact = (projected.artifacts as Array<Record<string, unknown>>)[0];
    const component = (projected.components as Array<Record<string, any>>)[0];

    expect(artifact).not.toHaveProperty('artifactId');
    expect(artifact).not.toHaveProperty('artifact_id');
    expect(artifact).not.toHaveProperty('availability');
    expect(component.data).not.toHaveProperty('artifactId');
    expect(component.data).not.toHaveProperty('availability');
  });

  it('recursively removes path aliases and redacts embedded private paths', () => {
    const nested = {
      ...structuredClone(taskResult),
      output: '{"file_path":"owner-12345678/system_execution-1/report.pdf"}',
      outputs: {
        report: {
          content: { filePath: '/mnt/workspace/private/report.pdf', note: 'Saved at /mnt/workspace/private/report.pdf' },
        },
      },
      iteratorIterations: [{ childResults: [{ components: [{ type: 'artifact', data: { storagePath: 'owner-12345678/system_execution-1/report.pdf' } }] }] }],
      toolTrace: [{ outputSummary: 'Uploaded to ceph://private-bucket/report.pdf' }],
      reasoningChain: [{ detail: 'Open https://storage.example/private/report.pdf?X-Amz-Signature=secret&X-Amz-Expires=600' }],
      judgeHistory: [{ id: 'judge-1', createdAt: new Date('2026-08-24T12:00:00.000Z') }],
    };

    const serialized = JSON.stringify(publicPlaybookTaskResult(nested, 'owner-1', 'execution-1'));
    expect(serialized).not.toContain('/mnt/workspace');
    expect(serialized).not.toContain('owner-12345678/system_execution-1');
    expect(serialized).not.toContain('filePath');
    expect(serialized).not.toContain('storagePath');
    expect(serialized).not.toContain('ceph://');
    expect(serialized).not.toContain('storage.example');
    expect(serialized).not.toContain('X-Amz-Signature');
    expect((publicPlaybookTaskResult(nested, 'owner-1', 'execution-1').judgeHistory as Array<Record<string, unknown>>)[0].createdAt)
      .toEqual(new Date('2026-08-24T12:00:00.000Z'));
  });

  it('redacts canonical paths split across direct stream chunks', () => {
    const redactor = new PlaybookTokenStreamRedactor();
    const key = 'execution-1:task-1:0';
    const emitted = [
      redactor.push(key, 'Stored owner-1234/system_exec'),
      redactor.push(key, 'ution-1/private.pdf successfully'),
      redactor.flush(key),
    ].join('');

    expect(emitted).toBe('Stored [REDACTED] successfully');
  });

  it('redacts presigned HTTPS URLs split across direct stream chunks', () => {
    const redactor = new PlaybookTokenStreamRedactor();
    const key = 'execution-1:task-1:0';
    const emitted = [
      redactor.push(key, 'Open https://storage.example/private/report.pdf?X-Amz'),
      redactor.push(key, '-Signature=secret now'),
      redactor.flush(key),
    ].join('');

    expect(emitted).toBe('Open https:[REDACTED] now');
    expect(emitted).not.toContain('storage.example');
    expect(emitted).not.toContain('Signature');
  });

  it('preserves public citation links while redacting signed storage links', () => {
    const projected = publicPlaybookTaskResult({
      taskId: 'search',
      iteration: 0,
      components: [{
        type: 'sources',
        data: {
          sources: [
            { title: 'Public source', url: 'https://example.com/article' },
            { title: 'Storage source', url: 'https://storage.example/private.pdf?X-Amz-Signature=secret' },
          ],
        },
      }],
    }, 'owner-1', 'execution-1');
    const sources = (projected.components as Array<Record<string, any>>)[0].data.sources;

    expect(sources[0].url).toBe('https://example.com/article');
    expect(sources[1].url).toBe('[REDACTED]');
  });
});
