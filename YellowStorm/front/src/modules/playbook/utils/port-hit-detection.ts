import type { TaskInputPort } from '../types';

function getPortTopPercent(idx: number, total: number): number {
  if (total <= 1) return 50;
  const step = 100 / (total + 1);
  return step * (idx + 1);
}

const HIT_ZONE_PX = 28;

export interface PortHit {
  port: TaskInputPort;
  portIndex: number;
  distance: number;
}

export function detectPortHit(
  inputPorts: TaskInputPort[],
  dropOffsetY: number,
  nodeHeight: number,
): PortHit | null {
  if (inputPorts.length === 0) return null;
  if (inputPorts.length === 1) {
    return {
      port: inputPorts[0],
      portIndex: 0,
      distance: 0,
    };
  }

  let closest: PortHit | null = null;
  let minDist = Infinity;

  for (let i = 0; i < inputPorts.length; i++) {
    const pct = getPortTopPercent(i, inputPorts.length);
    const portY = (pct / 100) * nodeHeight;
    const dist = Math.abs(dropOffsetY - portY);
    if (dist < minDist) {
      minDist = dist;
      closest = { port: inputPorts[i], portIndex: i, distance: dist };
    }
  }

  if (closest && closest.distance <= HIT_ZONE_PX) {
    return closest;
  }

  return null;
}
