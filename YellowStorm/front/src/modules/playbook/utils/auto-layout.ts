import Dagre from '@dagrejs/dagre';
import type { PlaybookTask, PlaybookEdge } from '../types';

const NODE_WIDTH = 384;
const NODE_HEIGHT = 160;
const NODE_SEP = 69;
const RANK_SEP = 115;
const ITERATOR_MIN_WIDTH = 360;
const ITERATOR_MIN_HEIGHT = 220;
const ITERATOR_PADDING = 32;
const ITERATOR_CHILD_NODE_WIDTH = 384;
const ITERATOR_CHILD_NODE_HEIGHT = 240;

function isIteratorTask(task: PlaybookTask): boolean {
  return task.taskType === 'iterator' || task.nodeType === 'iterator';
}

function getIteratorDimensions(task: PlaybookTask, tasks: PlaybookTask[]): { width: number; height: number } {
  const childTasks = tasks.filter((candidate) => candidate.containerConfig?.parentIteratorId === task.id);
  const bounds = childTasks.reduce(
    (acc, child) => {
      const relativeX = child.positionX - task.positionX;
      const relativeY = child.positionY - task.positionY;
      acc.maxX = Math.max(acc.maxX, relativeX + ITERATOR_CHILD_NODE_WIDTH);
      acc.maxY = Math.max(acc.maxY, relativeY + ITERATOR_CHILD_NODE_HEIGHT);
      return acc;
    },
    {
      maxX: ITERATOR_MIN_WIDTH,
      maxY: ITERATOR_MIN_HEIGHT,
    },
  );

  const autoWidth = Math.max(ITERATOR_MIN_WIDTH, bounds.maxX + ITERATOR_PADDING);
  const autoHeight = Math.max(ITERATOR_MIN_HEIGHT, bounds.maxY + ITERATOR_PADDING);
  return {
    width: Math.max(autoWidth, task.iteratorLayout?.width ?? 0),
    height: Math.max(autoHeight, task.iteratorLayout?.height ?? 0),
  };
}

export function autoLayoutTasks(
  tasks: PlaybookTask[],
  edges: PlaybookEdge[],
): PlaybookTask[] {
  if (tasks.length === 0) return tasks;

  const topLevelTasks = tasks.filter((task) => !task.containerConfig?.parentIteratorId);
  if (topLevelTasks.length === 0) {
    return tasks;
  }

  const topLevelTaskIds = new Set(topLevelTasks.map((task) => task.id));
  const topLevelEdges = edges.filter((edge) => topLevelTaskIds.has(edge.sourceId) && topLevelTaskIds.has(edge.targetId));

  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', nodesep: NODE_SEP, ranksep: RANK_SEP });
  const topLevelDimensions = new Map<string, { width: number; height: number }>();

  for (const task of topLevelTasks) {
    const dimensions = isIteratorTask(task)
      ? getIteratorDimensions(task, tasks)
      : { width: NODE_WIDTH, height: NODE_HEIGHT };
    topLevelDimensions.set(task.id, dimensions);
    g.setNode(task.id, dimensions);
  }
  for (const edge of topLevelEdges) {
    g.setEdge(edge.sourceId, edge.targetId);
  }

  Dagre.layout(g);

  const topLevelPositions = new Map(
    topLevelTasks.map((task) => {
      const pos = g.node(task.id);
      const dimensions = topLevelDimensions.get(task.id) ?? { width: NODE_WIDTH, height: NODE_HEIGHT };
      return [
        task.id,
        {
          x: pos.x - dimensions.width / 2,
          y: pos.y - dimensions.height / 2,
        },
      ] as const;
    }),
  );

  const topLevelDeltas = new Map(
    topLevelTasks.map((task) => {
      const nextPosition = topLevelPositions.get(task.id);
      return [
        task.id,
        {
          x: (nextPosition?.x ?? task.positionX) - task.positionX,
          y: (nextPosition?.y ?? task.positionY) - task.positionY,
        },
      ] as const;
    }),
  );

  return tasks.map((task) => {
    if (task.containerConfig?.parentIteratorId) {
      const parentDelta = topLevelDeltas.get(task.containerConfig.parentIteratorId);
      if (!parentDelta) {
        return task;
      }
      return {
        ...task,
        positionX: task.positionX + parentDelta.x,
        positionY: task.positionY + parentDelta.y,
      };
    }

    const pos = topLevelPositions.get(task.id);
    if (!pos) {
      return task;
    }
    return {
      ...task,
      positionX: pos.x,
      positionY: pos.y,
    };
  });
}
