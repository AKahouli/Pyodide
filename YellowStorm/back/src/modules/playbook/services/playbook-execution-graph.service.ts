import { Injectable } from '@nestjs/common';
import { StepStatus } from '../schemas/playbook-execution.schema';
import { LoggerService } from '../../logger';

@Injectable()
export class PlaybookExecutionGraphService {
  constructor(private readonly logger: LoggerService) {
    this.logger.setContext('PlaybookExecutionGraphService');
  }

  normalizeEdgeId(value: any): string {
    return value?.toString?.() || value || '';
  }

  buildEdgeKey(edge: any): string {
    const sourceId = this.normalizeEdgeId(edge.sourceId ?? edge.source_id);
    const targetId = this.normalizeEdgeId(edge.targetId ?? edge.target_id);
    const sourcePortId =
      this.normalizeEdgeId(edge.sourceOutputPortId ?? edge.source_output_port_id) || 'default';
    const targetPortId =
      this.normalizeEdgeId(edge.targetInputPortId ?? edge.target_input_port_id) || 'default';
    return `${sourceId}:${sourcePortId}->${targetId}:${targetPortId}`;
  }

  buildTaskMapFromSnapshot(snapshot: any): Map<string, any> {
    const map = new Map<string, any>();
    for (const task of snapshot?.tasks || []) {
      map.set(task.id, task);
    }
    return map;
  }

  findAncestorTaskIds(snapshot: any, taskId: string): string[] {
    const ancestors = new Set<string>();
    const queue = [taskId];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      for (const edge of snapshot?.edges || []) {
        const sourceId = this.normalizeEdgeId(edge.sourceId ?? edge.source_id);
        const targetId = this.normalizeEdgeId(edge.targetId ?? edge.target_id);
        if (targetId !== currentId || ancestors.has(sourceId)) {
          continue;
        }
        ancestors.add(sourceId);
        queue.push(sourceId);
      }
    }
    return [...ancestors];
  }

  findDescendantTaskIds(snapshot: any, taskId: string): string[] {
    const descendants = new Set<string>();
    const queue = [taskId];
    while (queue.length > 0) {
      const currentId = queue.shift()!;
      for (const edge of snapshot?.edges || []) {
        const sourceId = this.normalizeEdgeId(edge.sourceId ?? edge.source_id);
        const targetId = this.normalizeEdgeId(edge.targetId ?? edge.target_id);
        if (sourceId !== currentId || descendants.has(targetId)) {
          continue;
        }
        descendants.add(targetId);
        queue.push(targetId);
      }
    }
    descendants.delete(taskId);
    return [...descendants];
  }

  seedTaskOutputsFromExecution(
    execution: any,
    snapshot: any,
    ancestorTaskIds: string[],
  ): Map<string, string> {
    const taskOutputs = new Map<string, string>();
    const allowed = new Set(ancestorTaskIds);
    const taskMap = this.buildTaskMapFromSnapshot(snapshot);

    for (const tr of execution.taskResults || []) {
      if (
        !allowed.has(tr.taskId) ||
        tr.status !== StepStatus.COMPLETED ||
        !tr.output ||
        tr.isStale
      ) {
        continue;
      }
      taskOutputs.set(tr.taskId, tr.output);
      const task = taskMap.get(tr.taskId);
      const outputKey = task?.outputKey;
      if (outputKey) {
        taskOutputs.set(outputKey, tr.output);
      }
    }

    return taskOutputs;
  }

  buildWorkspaceContextFromUpstreamArtifacts(
    execution: any,
    snapshot: any,
    taskId: string,
  ): {
    workspaceContexts: Array<{ workspace_id: string; workspace_documents: any[] }>;
    inputFilesByPort: Array<{ port_id: string; document_ids: string[] }>;
  } {
    const docsByWorkspace = new Map<string, Map<string, any>>();
    const docIdsByPort = new Map<string, Set<string>>();
    const taskResultsById = new Map<string, any>();

    for (const tr of execution.taskResults || []) {
      taskResultsById.set(tr.taskId, tr);
    }

    for (const edge of snapshot?.edges || []) {
      const targetId = this.normalizeEdgeId(edge.targetId ?? edge.target_id);
      if (targetId !== taskId) continue;

      const sourceId = this.normalizeEdgeId(edge.sourceId ?? edge.source_id);
      const sourcePortId = edge.sourceOutputPortId || edge.source_output_port_id || 'default';
      const targetPortId = edge.targetInputPortId || edge.target_input_port_id || 'default';
      const taskResult = taskResultsById.get(sourceId);
      if (!taskResult || taskResult.status !== StepStatus.COMPLETED || taskResult.isStale) {
        continue;
      }

      const matchingArtifacts = (taskResult.artifacts || []).filter(
        (artifact: any) =>
          artifact?.portId === sourcePortId &&
          artifact?.artifactKind === 'document' &&
          typeof artifact?.url === 'string' &&
          artifact.url.trim() &&
          typeof artifact?.filename === 'string' &&
          artifact.filename.trim() &&
          !artifact.url.startsWith('/box/') &&
          !artifact.url.startsWith('sandbox:/box/'),
      );

      if (matchingArtifacts.length === 0) continue;
      if (!docIdsByPort.has(targetPortId)) {
        docIdsByPort.set(targetPortId, new Set<string>());
      }

      matchingArtifacts.forEach((artifact: any, index: number) => {
        const syntheticDocId = `artifact:${sourceId}:${sourcePortId}:${index}:${artifact.filename}`;
        const workspaceId =
          artifact?.metadata?.workspaceId ||
          artifact?.metadata?.workspace_id ||
          'playbook_artifacts';

        if (!docsByWorkspace.has(workspaceId)) {
          docsByWorkspace.set(workspaceId, new Map<string, any>());
        }

        docsByWorkspace.get(workspaceId)!.set(syntheticDocId, {
          _id: syntheticDocId,
          filename: artifact.filename,
          filepath: artifact.url,
          in_memory: false,
          language: 'fr',
          indexing_token: 1200,
          workspace_id: workspaceId,
          createdAt: null,
        });
        docIdsByPort.get(targetPortId)!.add(syntheticDocId);
      });
    }

    return {
      workspaceContexts: Array.from(docsByWorkspace.entries()).map(([workspace_id, docMap]) => ({
        workspace_id,
        workspace_documents: Array.from(docMap.values()),
      })),
      inputFilesByPort: Array.from(docIdsByPort.entries()).map(([port_id, ids]) => ({
        port_id,
        document_ids: Array.from(ids),
      })),
    };
  }

  resolveNodeInputs(execution: any, snapshot: any, taskId: string): any[] {
    const taskResultsById = new Map<string, any>();

    for (const tr of execution.taskResults || []) {
      taskResultsById.set(tr.taskId, tr);
    }

    const payloads: any[] = [];

    for (const edge of snapshot?.edges || []) {
      const targetId = this.normalizeEdgeId(edge.targetId ?? edge.target_id);
      if (targetId !== taskId) {
        continue;
      }

      const sourceId = this.normalizeEdgeId(edge.sourceId ?? edge.source_id);
      if (!sourceId || sourceId === '__trigger__') {
        continue;
      }

      const sourcePortId = this.normalizeEdgeId(
        edge.sourceOutputPortId ?? edge.source_output_port_id,
      ) || 'default';
      const targetPortId = this.normalizeEdgeId(
        edge.targetInputPortId ?? edge.target_input_port_id,
      ) || 'default';
      const taskResult = taskResultsById.get(sourceId);

      if (!taskResult || taskResult.status !== StepStatus.COMPLETED || taskResult.isStale) {
        continue;
      }

      // Prefer the keyed artifactsByPort index for O(1) lookup; fall back to scanning artifacts.
      const portArtifacts: any[] =
        taskResult.artifactsByPort?.[sourcePortId] ??
        taskResult.artifactsByPort?.[`out-${sourcePortId}`] ??
        (taskResult.artifacts || []).filter((a: any) => {
          const id = this.normalizeEdgeId(a?.portId ?? a?.port_id) || 'default';
          return id === sourcePortId;
        });

      for (const artifact of portArtifacts) {

        const metadata = {
          ...(artifact?.metadata && typeof artifact.metadata === 'object' ? artifact.metadata : {}),
          target_input_port_id: targetPortId,
        };

        const payload: any = {
          port_id: targetPortId,
          artifact_kind: artifact?.artifactKind || artifact?.artifact_kind || 'text',
          metadata,
          source_task_id: sourceId,
          source_port_id: sourcePortId,
        };

        const content = artifact?.content;
        if (typeof content === 'string' && content.length > 0) {
          payload.content = content;
        }

        if (artifact?.data && typeof artifact.data === 'object') {
          payload.data = artifact.data;
        }

        if (
          artifact?.url ||
          artifact?.filename ||
          artifact?.mimeType ||
          artifact?.mime_type ||
          metadata?.document_id ||
          metadata?.documentId
        ) {
          payload.ref = {
            ...(metadata?.document_id || metadata?.documentId
              ? { document_id: metadata.document_id || metadata.documentId }
              : {}),
            ...(metadata?.workspaceId || metadata?.workspace_id
              ? { workspace_id: metadata.workspaceId || metadata.workspace_id }
              : {}),
            ...(artifact?.url ? { url: artifact.url } : {}),
            ...(artifact?.filename ? { filename: artifact.filename } : {}),
            ...(artifact?.mimeType || artifact?.mime_type
              ? { mime_type: artifact.mimeType || artifact.mime_type }
              : {}),
          };
        }

        // Routing provenance for reruns comes from the current graph edge.
        if (artifact?.producedAt || artifact?.produced_at) {
          payload.produced_at = artifact.producedAt || artifact.produced_at;
        }

        payloads.push(payload);
      }
    }

    return payloads;
  }

  mergeWorkspaceContexts(
    baseContexts: Array<{ workspace_id: string; workspace_documents: any[] }>,
    extraContexts: Array<{ workspace_id: string; workspace_documents: any[] }>,
  ): Array<{ workspace_id: string; workspace_documents: any[] }> {
    const merged = new Map<string, Map<string, any>>();

    for (const ctx of [...(baseContexts || []), ...(extraContexts || [])]) {
      const workspaceId = ctx.workspace_id;
      if (!workspaceId) continue;
      if (!merged.has(workspaceId)) {
        merged.set(workspaceId, new Map<string, any>());
      }
      const docs = merged.get(workspaceId)!;
      for (const doc of ctx.workspace_documents || []) {
        const docId = doc?._id || doc?.id;
        if (!docId) continue;
        docs.set(String(docId), doc);
      }
    }

    return Array.from(merged.entries()).map(([workspace_id, docs]) => ({
      workspace_id,
      workspace_documents: Array.from(docs.values()),
    }));
  }

  buildRunStepRoutingState(
    execution: any,
    snapshot: any,
    taskId: string,
  ): {
    edges: any[];
    upstreamResults: any[];
  } {
    const incomingEdges = (snapshot?.edges || []).filter(
      (edge: any) => this.normalizeEdgeId(edge.targetId ?? edge.target_id) === taskId,
    );

    const sourceIds = new Set(
      incomingEdges
        .map((edge: any) => this.normalizeEdgeId(edge.sourceId ?? edge.source_id))
        .filter(Boolean),
    );

    const upstreamResults = (execution?.taskResults || [])
      .filter((tr: any) => sourceIds.has(tr.taskId) && !tr.isStale)
      .map((tr: any) => ({
        task_id: tr.taskId,
        status: tr.status,
        error: tr.error || '',
        duration_ms: tr.durationMs || 0,
        artifacts: (tr.artifacts || []).map((artifact: any) => ({
          port_id: artifact.portId || 'default',
          artifact_kind: artifact.artifactKind || 'text',
          content: artifact.content || '',
          url: artifact.url || '',
          filename: artifact.filename || '',
          mime_type: artifact.mimeType || '',
          size: artifact.size || 0,
        })),
      }));

    return {
      edges: incomingEdges
        .map((edge: any) => ({
          source_id: this.normalizeEdgeId(edge.sourceId ?? edge.source_id),
          target_id: this.normalizeEdgeId(edge.targetId ?? edge.target_id),
          source_output_port_id: edge.sourceOutputPortId || edge.source_output_port_id || 'default',
          target_input_port_id: edge.targetInputPortId || edge.target_input_port_id || 'default',
        }))
        // Single-step reruns do not carry live trigger_context, so replayable
        // upstream artifacts must drive routing instead of dead __trigger__ edges.
        .filter((edge: any) => edge.source_id !== '__trigger__'),
      upstreamResults,
    };
  }

  mergeSnapshotForNewTask(existingSnapshot: any, playbook: any, taskId: string): any {
    const snapshotTasks = existingSnapshot?.tasks || [];
    const snapshotEdges = existingSnapshot?.edges || [];
    const playbookTasks = playbook?.tasks || [];
    const playbookEdges = playbook?.edges || [];

    const existingTaskIds = new Set<string>(snapshotTasks.map((task: any) => task.id));
    const playbookTaskMap = new Map<string, any>(playbookTasks.map((task: any) => [task.id, task]));
    const additionalTaskIds = new Set<string>();
    const queue = [taskId];

    while (queue.length > 0) {
      const currentTaskId = queue.shift()!;
      if (existingTaskIds.has(currentTaskId) || additionalTaskIds.has(currentTaskId)) {
        continue;
      }

      const currentTask = playbookTaskMap.get(currentTaskId);
      if (!currentTask) {
        continue;
      }

      additionalTaskIds.add(currentTaskId);

      for (const edge of playbookEdges) {
        const sourceId = this.normalizeEdgeId(edge.sourceId ?? edge.source_id);
        const targetId = this.normalizeEdgeId(edge.targetId ?? edge.target_id);
        if (
          sourceId === currentTaskId &&
          !existingTaskIds.has(targetId) &&
          !additionalTaskIds.has(targetId)
        ) {
          queue.push(targetId);
        }
        if (
          targetId === currentTaskId &&
          !existingTaskIds.has(sourceId) &&
          !additionalTaskIds.has(sourceId)
        ) {
          queue.push(sourceId);
        }
      }
    }

    const mergedTaskIds = new Set<string>([...existingTaskIds, ...additionalTaskIds]);
    const mergedTasks = [
      ...snapshotTasks,
      ...Array.from(additionalTaskIds)
        .map((id) => playbookTaskMap.get(id))
        .filter(Boolean)
        .map((task: any) => ((task as any).toObject ? (task as any).toObject() : task)),
    ];

    const seenEdges = new Set<string>();
    const mergedEdges = [...snapshotEdges];
    for (const edge of snapshotEdges) {
      seenEdges.add(this.buildEdgeKey(edge));
    }

    for (const edge of playbookEdges) {
      const sourceId = this.normalizeEdgeId(edge.sourceId ?? edge.source_id);
      const targetId = this.normalizeEdgeId(edge.targetId ?? edge.target_id);
      if (!mergedTaskIds.has(sourceId) || !mergedTaskIds.has(targetId)) {
        continue;
      }
      const edgeKey = this.buildEdgeKey(edge);
      if (seenEdges.has(edgeKey)) {
        continue;
      }
      seenEdges.add(edgeKey);
      mergedEdges.push((edge as any).toObject ? (edge as any).toObject() : edge);
    }

    return {
      tasks: mergedTasks,
      edges: mergedEdges,
    };
  }

  refreshSnapshotTask(existingSnapshot: any, playbook: any, taskId: string): any {
    const snapshot = this.mergeSnapshotForNewTask(existingSnapshot, playbook, taskId);
    const playbookTask = (playbook?.tasks || []).find((task: any) => task.id === taskId);
    if (!playbookTask) {
      return snapshot;
    }

    return {
      ...snapshot,
      tasks: (snapshot?.tasks || []).map((task: any) =>
        task.id === taskId
          ? (playbookTask as any).toObject
            ? (playbookTask as any).toObject()
            : playbookTask
          : task,
      ),
    };
  }

  sanitizeEdgesForTasks(tasks: any[], edges: any[]): any[] {
    const triggerSourceId = '__trigger__';
    const triggerPortIds = new Set(['mail_data', 'mail_attachments']);
    const taskMap = new Map<string, any>();
    for (const task of tasks || []) {
      taskMap.set(task.id, task);
    }

    return (edges || []).filter((edge: any) => {
      const sourceId = edge.sourceId || edge.source_id;
      const targetId = edge.targetId || edge.target_id;
      const sourceTask = taskMap.get(sourceId);
      const targetTask = taskMap.get(targetId);
      const isTriggerSource = sourceId === triggerSourceId;

      if ((!sourceTask && !isTriggerSource) || !targetTask) {
        this.logger.warn('Dropping edge with missing task reference', {
          edgeId: edge.id,
          sourceId,
          targetId,
        });
        return false;
      }

      const sourcePortId = edge.sourceOutputPortId || edge.source_output_port_id || 'default';
      const targetPortId = edge.targetInputPortId || edge.target_input_port_id || 'default';
      const sourcePorts = sourceTask?.outputPorts || sourceTask?.output_ports || [];
      const targetPorts = targetTask.inputPorts || targetTask.input_ports || [];

      const sourcePortExists = isTriggerSource
        ? triggerPortIds.has(sourcePortId)
        : sourcePorts.length === 0 || sourcePorts.some((p: any) => p.id === sourcePortId);
      const targetPortExists =
        targetPorts.length === 0 || targetPorts.some((p: any) => p.id === targetPortId);

      if (!sourcePortExists || !targetPortExists) {
        this.logger.warn('Dropping edge with stale port reference', {
          edgeId: edge.id,
          sourceId,
          sourcePortId,
          targetId,
          targetPortId,
          sourcePortIds: sourcePorts.map((p: any) => p.id),
          targetPortIds: targetPorts.map((p: any) => p.id),
        });
        return false;
      }

      return true;
    });
  }

  gatherContext(task: any, taskOutputs: Map<string, string>, snapshot: any): string {
    const contextParts: string[] = [];
    const coveredSourceIds = new Set<string>();

    if (task.inputPorts && task.inputPorts.length > 0 && snapshot?.edges) {
      const inputPortsById = new Map<string, any>();
      for (const port of task.inputPorts) {
        inputPortsById.set(port.id, port);
      }

      for (const edge of snapshot.edges) {
        if (edge.targetId !== task.id) continue;

        const sourcePortId = edge.sourceOutputPortId || 'default';
        const targetPortId = edge.targetInputPortId || 'default';
        const parentOutput =
          taskOutputs.get(`${edge.sourceId}:${sourcePortId}`) || taskOutputs.get(edge.sourceId);

        if (parentOutput) {
          const targetPort = inputPortsById.get(targetPortId);
          const label = targetPort?.name || sourcePortId;
          contextParts.push(`[${label}]:\n${parentOutput}`);
          coveredSourceIds.add(edge.sourceId);
        }
      }
    }

    if (task.inputKeys && task.inputKeys.length > 0) {
      for (const key of task.inputKeys) {
        const output = taskOutputs.get(key);
        if (output) contextParts.push(`[${key}]: ${output}`);
      }
    }

    if (snapshot?.edges) {
      for (const edge of snapshot.edges) {
        if (edge.targetId === task.id && !coveredSourceIds.has(edge.sourceId)) {
          const parentOutput = taskOutputs.get(edge.sourceId);
          if (parentOutput && !contextParts.some((p) => p.includes(parentOutput))) {
            contextParts.push(parentOutput);
          }
        }
      }
    }

    return contextParts.join('\n\n');
  }

}
