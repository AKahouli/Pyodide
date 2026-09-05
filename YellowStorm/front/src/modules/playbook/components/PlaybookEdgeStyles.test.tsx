import type { CSSProperties } from 'react';
import type { EdgeProps } from '@xyflow/react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Edge as AiEdge } from '@/components/ai-elements/edge';
import type { OverviewEdge } from '../utils/overview-canvas';
import { ConditionalEdge } from './ConditionalEdge';
import { DataBindingEdge } from './DataBindingEdge';
import { OverviewControlEdge } from './OverviewControlEdge';

vi.mock('@xyflow/react', () => ({
  BaseEdge: ({ id, style }: { id: string; style?: CSSProperties }) => (
    <path data-testid={`edge-${id}`} style={style} />
  ),
  EdgeLabelRenderer: () => null,
  getBezierPath: () => ['M 0 0 L 10 10', 5, 5],
  getSmoothStepPath: () => ['M 0 0 L 10 10', 5, 5],
}));

function edgeProps(
  id: string,
  data?: Record<string, unknown>,
  style?: CSSProperties,
): EdgeProps {
  return {
    id,
    source: 'source',
    target: 'target',
    sourceX: 0,
    sourceY: 0,
    targetX: 10,
    targetY: 10,
    sourcePosition: 'right',
    targetPosition: 'left',
    data,
    style,
  } as EdgeProps;
}

describe('playbook edge visibility', () => {
  it('restarts remounted edge markers at the global animation phase', () => {
    const beginElementAt = vi.fn();
    const originalBeginElementAt = Object.getOwnPropertyDescriptor(SVGElement.prototype, 'beginElementAt');
    Object.defineProperty(SVGElement.prototype, 'beginElementAt', {
      configurable: true,
      value: beginElementAt,
    });
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(2500).mockReturnValueOnce(4000);

    try {
      const firstRender = render(
        <svg>
          <AiEdge.Animated {...edgeProps('animated-first')} />
        </svg>,
      );

      expect(firstRender.container.querySelector('animateMotion')).toHaveAttribute('begin', 'indefinite');
      expect(beginElementAt).toHaveBeenLastCalledWith(-0.5);

      firstRender.unmount();
      render(
        <svg>
          <AiEdge.Animated {...edgeProps('animated-second')} />
        </svg>,
      );

      expect(beginElementAt).toHaveBeenLastCalledWith(-0);
    } finally {
      now.mockRestore();
      if (originalBeginElementAt) {
        Object.defineProperty(SVGElement.prototype, 'beginElementAt', originalBeginElementAt);
      } else {
        delete (SVGElement.prototype as SVGElement & { beginElementAt?: unknown }).beginElementAt;
      }
    }
  });

  it('uses a bold stroke while preserving sequential execution colors', () => {
    render(
      <svg>
        <AiEdge.Animated {...edgeProps('sequential', undefined, { stroke: 'var(--destructive)', strokeWidth: 1 })} />
      </svg>,
    );

    const edge = screen.getByTestId('edge-sequential');
    expect(edge.style.stroke).toBe('var(--destructive)');
    expect(edge.style.strokeWidth).toBe('2.5');
  });

  it('keeps warning edges bold and yellow', () => {
    render(
      <svg>
        <AiEdge.AnimatedWarning {...edgeProps('warning')} />
      </svg>,
    );

    const edge = screen.getByTestId('edge-warning');
    expect(edge.style.stroke).toBe('var(--color-yellow-500)');
    expect(edge.style.strokeWidth).toBe('2.5');
  });

  it('keeps conditional errors and data warnings distinct', () => {
    render(
      <svg>
        <ConditionalEdge {...edgeProps('conditional', { routerLabel: '__error__' }, { stroke: 'blue' })} />
        <DataBindingEdge {...edgeProps('binding', { status: 'warning' })} />
      </svg>,
    );

    const conditional = screen.getByTestId('edge-conditional');
    expect(conditional.style.stroke).toBe('var(--destructive)');
    expect(conditional.style.strokeWidth).toBe('2.5');
    expect(conditional.style.strokeDasharray).toBe('6 4');

    const binding = screen.getByTestId('edge-binding');
    expect(binding.style.stroke).toBe('var(--destructive)');
    expect(binding.style.strokeWidth).toBe('2.5');
    expect(binding.style.opacity).toBe('1');
  });

  it('uses the theme chart token for normal data bindings', () => {
    render(
      <svg>
        <DataBindingEdge {...edgeProps('binding-normal', { status: 'ok' })} />
      </svg>,
    );

    const binding = screen.getByTestId('edge-binding-normal');
    expect(binding.style.stroke).toBe('var(--chart-4)');
    expect(binding.style.strokeWidth).toBe('2.5');
    expect(binding.style.opacity).toBe('1');
  });

  it('strengthens active overview edges without changing dimmed edges', () => {
    render(
      <svg>
        <OverviewControlEdge {...edgeProps('overview-active', { kind: 'sequential', dimmed: false }) as EdgeProps<OverviewEdge>} />
        <OverviewControlEdge {...edgeProps('overview-dimmed', { kind: 'sequential', dimmed: true }) as EdgeProps<OverviewEdge>} />
      </svg>,
    );

    const active = screen.getByTestId('edge-overview-active');
    expect(active.style.strokeWidth).toBe('2.5');
    expect(active.style.opacity).toBe('0.9');

    const dimmed = screen.getByTestId('edge-overview-dimmed');
    expect(dimmed.style.strokeWidth).toBe('1');
    expect(dimmed.style.opacity).toBe('0.08');
  });
});
