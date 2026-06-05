import { useCallback } from 'react';
import type { DragEvent, Dispatch, SetStateAction } from 'react';
import type { Node } from '@xyflow/react';

import { cloneRouterConfig } from './helpers/router-template';
import type { ConnectorDropPayload } from '../components/PlaybookNode';
import type { PlaybookTask, TaskTemplate, ToolBinding } from '../types';

export interface PlaybookBindingModalState {
  open: boolean;
  taskId: string;
  connectorId: string;
  connectorName: string;
  actions: Array<{ key: string; label: string }>;
  existingBinding: ToolBinding | null;
}

interface PlaybookCanvasNodeHandlersOptions {
  playbook: { tasks: PlaybookTask[] } | null;
  nodes: Node[];
  reactFlowScreenToFlowPosition: (point: { x: number; y: number }) => { x: number; y: number };
  addNode: (task: PlaybookTask) => void;
  setEditingTask: (task: PlaybookTask | null) => void;
  setEditorOpen: (open: boolean) => void;
  setBindingModalState: Dispatch<SetStateAction<PlaybookBindingModalState | null>>;
  addToolBindingToTask: (taskId: string, binding: ToolBinding) => void;
  routerNodeDefaultTitle: string;
  humanApprovalNodeDefaultTitle: string;
}

interface PlaybookCanvasNodeHandlers {
  handleAddStep: () => void;
  handleAddRouterNode: () => void;
  handleAddHumanApprovalNode: () => void;
  handleAddStepFromTemplate: (template: TaskTemplate) => void;
  handleEditNode: (nodeId: string) => void;
  handleCloneNode: (nodeId: string) => void;
  handleConnectorDrop: (taskId: string, payload: ConnectorDropPayload) => void;
  handleConnectorDragStart: (payload: ConnectorDropPayload) => void;
  handleBindingModalSave: (taskId: string, binding: ToolBinding) => void;
  handleCanvasDrop: (e: DragEvent) => void;
}

const taskCenterStyleOffset = (screenToFlowPosition: (point: { x: number; y: number }) => { x: number; y: number }) => {
  const canvasEl = document.querySelector('.react-flow');
  const width = canvasEl?.clientWidth ?? 800;
  const height = canvasEl?.clientHeight ?? 600;
  return screenToFlowPosition({ x: width / 2, y: height / 2 });
};

export function usePlaybookCanvasNodeHandlers({
  playbook,
  nodes,
  reactFlowScreenToFlowPosition,
  addNode,
  setEditingTask,
  setEditorOpen,
  setBindingModalState,
  addToolBindingToTask,
  routerNodeDefaultTitle,
  humanApprovalNodeDefaultTitle,
}: PlaybookCanvasNodeHandlersOptions): PlaybookCanvasNodeHandlers {
  const getCenter = () => taskCenterStyleOffset(reactFlowScreenToFlowPosition);

  const handleAddStep = useCallback(() => {
    const taskId = crypto.randomUUID();
    const existingCount = playbook?.tasks.length || 0;
    const center = getCenter();

    const newTask: PlaybookTask = {
      id: taskId,
      title: `Step ${existingCount + 1}`,
      description: '',
      assignedAgentId: null,
      executionMode: 'agent',
      selectedAction: undefined,
      executionOrder: existingCount,
      positionX: center.x,
      positionY: center.y,
      interruptBefore: false,
      interruptAfter: false,
      allowClarification: false,
      clarificationPrompt: '',
      maxClarifications: 3,
      inputKeys: [],
      outputKey: '',
      enabled: true,
      notifyOnComplete: false,
      notifyEmails: [],
      inputFiles: [],
      taskType: 'generic',
      inputPorts: [{ id: 'default', name: 'Input', artifactKind: 'text', required: false }],
      outputPorts: [{ id: 'default', name: 'Output', artifactKind: 'text' }],
    };
    addNode(newTask);
  }, [addNode, playbook?.tasks.length, reactFlowScreenToFlowPosition]);

  const handleAddRouterNode = useCallback(() => {
    const taskId = crypto.randomUUID();
    const existingCount = playbook?.tasks.length || 0;
    const center = getCenter();

    const newTask: PlaybookTask = {
      id: taskId,
      title: routerNodeDefaultTitle,
      description: '',
      assignedAgentId: null,
      executionMode: 'agent',
      executionOrder: existingCount,
      positionX: center.x,
      positionY: center.y,
      interruptBefore: false,
      interruptAfter: false,
      allowClarification: false,
      clarificationPrompt: '',
      maxClarifications: 3,
      inputKeys: [],
      outputKey: '',
      enabled: true,
      notifyOnComplete: false,
      notifyEmails: [],
      inputFiles: [],
      taskType: 'generic',
      nodeType: 'router',
      inputPorts: [{ id: 'default', name: 'Input', artifactKind: 'text', required: false }],
      outputPorts: [
        { id: 'retry', name: 'retry', artifactKind: 'text' },
        { id: 'done', name: 'done', artifactKind: 'text' },
        { id: '__error__', name: '__error__', artifactKind: 'text' },
      ],
      routerConfig: { outputLabels: ['retry', 'done', '__error__'], maxIterations: 3 },
    };
    addNode(newTask);
  }, [addNode, playbook?.tasks.length, reactFlowScreenToFlowPosition, routerNodeDefaultTitle]);

  const handleAddHumanApprovalNode = useCallback(() => {
    const taskId = crypto.randomUUID();
    const existingCount = playbook?.tasks.length || 0;
    const center = getCenter();

    const newTask: PlaybookTask = {
      id: taskId,
      title: humanApprovalNodeDefaultTitle,
      description: '',
      assignedAgentId: null,
      executionMode: 'agent',
      executionOrder: existingCount,
      positionX: center.x,
      positionY: center.y,
      interruptBefore: false,
      interruptAfter: false,
      allowClarification: false,
      clarificationPrompt: '',
      maxClarifications: 3,
      inputKeys: [],
      outputKey: '',
      enabled: true,
      notifyOnComplete: false,
      notifyEmails: [],
      inputFiles: [],
      taskType: 'generic',
      nodeType: 'human_approval',
      inputPorts: [{ id: 'default', name: 'Input', artifactKind: 'text', required: false }],
      outputPorts: [{ id: 'default', name: 'Output', artifactKind: 'text' }],
      humanApprovalConfig: { promptTemplate: '', timeoutSeconds: 3600 },
    };
    addNode(newTask);
  }, [addNode, playbook?.tasks.length, reactFlowScreenToFlowPosition, humanApprovalNodeDefaultTitle]);

  const handleAddStepFromTemplate = useCallback(
    (template: TaskTemplate) => {
      const taskId = crypto.randomUUID();
      const existingCount = playbook?.tasks.length || 0;
      const center = getCenter();

      const isRouterTemplate = template.nodeType === 'router';
      const routerConfig = isRouterTemplate ? cloneRouterConfig(template.routerConfig) : null;
      const outputPorts = isRouterTemplate
        ? routerConfig!.outputLabels.map((label) => ({ id: label, name: label, artifactKind: 'text' as const }))
        : template.outputPorts.map((p) => ({ ...p }));

      const newTask: PlaybookTask = {
        id: taskId,
        title: `${template.title} ${existingCount + 1}`,
        description: template.description,
        assignedAgentId: template.executionMode === 'agent' ? (template.assignedAgentId ?? null) : null,
        executionMode: (template.executionMode as PlaybookTask['executionMode']) ?? 'agent',
        selectedAction: template.executionMode === 'action' ? (template.selectedAction ?? undefined) : undefined,
        executionOrder: existingCount,
        positionX: center.x,
        positionY: center.y,
        interruptBefore: false,
        interruptAfter: false,
        allowClarification: false,
        clarificationPrompt: '',
        maxClarifications: 3,
        inputKeys: [],
        outputKey: '',
        enabled: true,
        notifyOnComplete: false,
        notifyEmails: [],
        inputFiles: [],
        taskType: template.nodeType === 'iterator' ? 'iterator' : template.nodeType === 'evaluation' ? 'evaluation' : 'generic',
        nodeType: template.nodeType,
        templateType: template.type,
        inputPorts: template.inputPorts.map((p) => ({ ...p })),
        outputPorts,
        iteratorConfig: template.iteratorConfig ? { ...template.iteratorConfig } : null,
        routerConfig,
        humanApprovalConfig:
          template.nodeType === 'human_approval'
            ? template.humanApprovalConfig
              ? {
                  promptTemplate: template.humanApprovalConfig.promptTemplate,
                  timeoutSeconds: template.humanApprovalConfig.timeoutSeconds,
                }
              : {
                  promptTemplate: '',
                  timeoutSeconds: 3600,
                }
            : null,
        retryPolicy: template.retryPolicy ? { ...template.retryPolicy } : null,
        modelId: template.modelId ?? null,
      };
      addNode(newTask);
    },
    [addNode, playbook?.tasks.length, reactFlowScreenToFlowPosition],
  );

  const handleEditNode = useCallback(
    (nodeId: string) => {
      const taskFromPlaybook = playbook?.tasks.find((task) => task.id === nodeId) ?? null;
      const node = nodes.find((candidate) => candidate.id === nodeId);
      if (taskFromPlaybook) {
        setEditingTask(taskFromPlaybook);
        setEditorOpen(true);
        return;
      }
      if (node) {
        setEditingTask(node.data as unknown as PlaybookTask);
        setEditorOpen(true);
      }
    },
    [nodes, playbook?.tasks, setEditingTask, setEditorOpen],
  );

  const handleCloneNode = useCallback(
    (nodeId: string) => {
      const node = nodes.find((candidate) => candidate.id === nodeId);
      if (!node) return;

      const sourceData = node.data as unknown as PlaybookTask;
      const clonedTask: PlaybookTask = {
        ...sourceData,
        id: crypto.randomUUID(),
        title: `${sourceData.title} (copy)`,
        executionOrder: nodes.length,
        positionX: node.position.x + 50,
        positionY: node.position.y + 80,
        enabled: sourceData.enabled !== false,
        stepReplayMode: 'live',
        hasValidatedReplay: undefined,
        activeReplayId: null,
        activeReplayVersion: null,
        activeReplayIsStale: undefined,
        activeReplayStaleReasons: undefined,
        activeReplayPreserveOutputFormat: undefined,
        activeReplayFormatGuideStatus: 'disabled',
        activeReplayFormatGuideError: null,
        activeReplayLabel: null,
        isSavingReplayBaseline: undefined,
        hasOutputFormatTemplate: undefined,
        activeOutputFormatTemplateId: null,
        activeOutputFormatTemplateVersion: null,
        activeOutputFormatStatus: null,
        activeOutputFormatError: null,
        isCapturingOutputFormat: undefined,
      };
      addNode(clonedTask);
    },
    [nodes, addNode],
  );

  const handleConnectorDrop = useCallback(
    (taskId: string, payload: ConnectorDropPayload) => {
      const task = playbook?.tasks.find((candidate) => candidate.id === taskId);
      const existingBinding = task?.toolBindings?.find((binding) => binding.connectorId === payload.connectorId) ?? null;
      setBindingModalState({
        open: true,
        taskId,
        connectorId: payload.connectorId,
        connectorName: payload.connectorName,
        actions: payload.actions,
        existingBinding,
      });
    },
    [playbook?.tasks, setBindingModalState],
  );

  const handleConnectorDragStart = useCallback((payload: ConnectorDropPayload) => {
    void payload;
  }, []);

  const handleBindingModalSave = useCallback(
    (taskId: string, binding: ToolBinding) => {
      addToolBindingToTask(taskId, binding);
    },
    [addToolBindingToTask],
  );

  const handleCanvasDrop = useCallback(
    (e: DragEvent) => {
      if (e.target !== e.currentTarget) return;

      try {
        const raw = e.dataTransfer.getData('application/json');
        if (!raw) return;
        const payload = JSON.parse(raw);
        if (payload?.type !== 'connector' || !payload?.connectorId) return;

        const taskId = crypto.randomUUID();
        const existingCount = playbook?.tasks.length || 0;
        const center = reactFlowScreenToFlowPosition({ x: e.clientX, y: e.clientY });
        const newTask: PlaybookTask = {
          id: taskId,
          title: `${payload.connectorName} Step`,
          description: '',
          assignedAgentId: null,
          executionMode: 'agent',
          selectedAction: undefined,
          executionOrder: existingCount,
          positionX: center.x,
          positionY: center.y,
          interruptBefore: false,
          interruptAfter: false,
          allowClarification: false,
          clarificationPrompt: '',
          maxClarifications: 3,
          inputKeys: [],
          outputKey: '',
          enabled: true,
          notifyOnComplete: false,
          notifyEmails: [],
          inputFiles: [],
          taskType: 'generic',
          inputPorts: [{ id: 'default', name: 'Input', artifactKind: 'text', required: false }],
          outputPorts: [{ id: 'default', name: 'Output', artifactKind: 'text' }],
        };
        addNode(newTask);
        const existingBinding = null;
        setBindingModalState({
          open: true,
          taskId,
          connectorId: payload.connectorId,
          connectorName: payload.connectorName,
          actions: payload.actions,
          existingBinding,
        });
      } catch (_error) {
        return;
      }
    },
    [playbook?.tasks, reactFlowScreenToFlowPosition, addNode, setBindingModalState],
  );

  return {
    handleAddStep,
    handleAddRouterNode,
    handleAddHumanApprovalNode,
    handleAddStepFromTemplate,
    handleEditNode,
    handleCloneNode,
    handleConnectorDrop,
    handleConnectorDragStart,
    handleBindingModalSave,
    handleCanvasDrop,
  };
}
