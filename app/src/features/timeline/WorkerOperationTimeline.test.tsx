import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OperationSummary } from '../../domain/workerOperation';
import { GROUP } from '../../domain/cost-tree';
import { useViz } from '../../store';
import WorkerOperationTimeline from './WorkerOperationTimeline';
import {
  hitTestOperation,
  operationBarGeometry,
  operationDurationScaleMs,
  operationLaneColor,
  operationMaximumDurationMs,
} from './workerOperationTimelineModel';

const fixture = vi.hoisted(() => ({
  state: vi.fn(),
  seek: vi.fn(),
  shift: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('../../application/WorkerTreeProvider', () => ({
  useActiveWorkerOperationState: fixture.state,
  useActiveWorkerOperationSeekState: fixture.seek,
}));

const first: OperationSummary = {
  ordinal: 64,
  ref: { iterId: '17', batchId: '2', operationId: '0' },
  section: 'pre_ffn',
  layer: 3,
  startMs: 10,
  endMs: 10.5,
};
const second: OperationSummary = {
  ordinal: 65,
  ref: { iterId: '17', batchId: '2', operationId: '1' },
  section: 'ffn',
  layer: 3,
  startMs: 12,
  endMs: 13,
};

function pointerEvent(type: string, pointerId: number, clientX: number): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  return event;
}

beforeEach(() => {
  useViz.setState({ operation: null });
  fixture.shift.mockReset();
  fixture.navigate.mockReset();
  fixture.state.mockReturnValue({
    status: 'ready',
    worker: { key: 'ffn/0' },
    viewport: {
      viewportOffset: 64,
      pending: null,
      buffer: { offset: 0, total: 256, batchRole: 'slot', operations: [first, second] },
    },
    operations: [first, second],
    selected: null,
    shift: fixture.shift,
    navigate: fixture.navigate,
  });
  fixture.seek.mockReturnValue({ status: 'idle', atMs: null, hits: [], choose: null });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D);
});

describe('WorkerOperationTimeline', () => {
  it('renders one accessible Canvas track without per-operation DOM rows', () => {
    render(<WorkerOperationTimeline />);
    expect(screen.getByRole('application', { name: /Exact worker operations/ })).toBeVisible();
    expect(document.querySelectorAll('canvas')).toHaveLength(1);
    expect(document.querySelectorAll('rect')).toHaveLength(0);
    expect(screen.getByLabelText(/Duration axis from 0 to/)).toBeVisible();
    expect(screen.getByText('max 1.00 ms')).toBeVisible();
    expect(screen.getByText('P95 1.00 ms')).toBeVisible();
    expect(screen.getByText('0.00 ms')).toBeVisible();
  });

  it('click hit-tests the equal-width operation cells and atomically selects the exact ref', () => {
    render(<WorkerOperationTimeline />);
    const track = screen.getByRole('application');
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      width: 300,
      height: 48,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 300,
      bottom: 48,
      toJSON: () => ({}),
    });
    fireEvent(track, pointerEvent('pointerdown', 1, 250));
    fireEvent(track, pointerEvent('pointerup', 1, 250));

    expect(useViz.getState()).toMatchObject({ operation: second.ref, cursorMs: 12 });
  });

  it('restores a detailed hover tooltip for the operation under the pointer', async () => {
    render(<WorkerOperationTimeline />);
    const track = screen.getByRole('application');
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      width: 300,
      height: 48,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 300,
      bottom: 48,
      toJSON: () => ({}),
    });

    fireEvent(track, pointerEvent('pointermove', 9, 50));

    expect(await screen.findByRole('tooltip')).toHaveTextContent(
      'iter 17, slot 2, pre_ffn · layer 3, 10.000 to 10.500 milliseconds',
    );
  });

  it('navigates during drag and suppresses pointer-up click selection', () => {
    render(<WorkerOperationTimeline />);
    const track = screen.getByRole('application');
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      width: 300,
      height: 48,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 300,
      bottom: 48,
      toJSON: () => ({}),
    });
    fireEvent(track, pointerEvent('pointerdown', 2, 250));
    fireEvent(track, pointerEvent('pointermove', 2, 100));

    expect(fixture.navigate).toHaveBeenCalledWith(1);

    fireEvent(track, pointerEvent('pointerup', 2, 100));

    expect(fixture.navigate).toHaveBeenCalledTimes(1);
    expect(useViz.getState().operation).toBeNull();
  });

  it('maps drag distance to operation-count navigation', () => {
    render(<WorkerOperationTimeline />);
    const track = screen.getByRole('application');
    vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
      width: 300,
      height: 48,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 300,
      bottom: 48,
      toJSON: () => ({}),
    });
    fireEvent(track, pointerEvent('pointerdown', 3, 270));
    fireEvent(track, pointerEvent('pointermove', 3, 120));

    expect(fixture.navigate).toHaveBeenCalledWith(1);
  });

  it('labels FFN identities as slots instead of generic batches', () => {
    fixture.state.mockReturnValue({
      ...fixture.state(),
      viewport: {
        ...fixture.state().viewport,
        buffer: { ...fixture.state().viewport.buffer, batchRole: 'slot' },
      },
      selected: first,
    });
    render(<WorkerOperationTimeline />);

    expect(screen.getByText(/iter 17 · slot 2 ·/)).toBeVisible();
    expect(screen.queryByText('256 exact operations')).not.toBeInTheDocument();
    expect(screen.getByLabelText('slot color legend')).toBeVisible();
    expect(screen.getByText('color →')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Previous' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });

  it('supports one focus target and arrow-key operation navigation', () => {
    render(<WorkerOperationTimeline />);
    const track = screen.getByRole('application');
    fireEvent.keyDown(track, { key: 'ArrowRight' });
    expect(useViz.getState().operation).toEqual(first.ref);
    expect(track).toHaveAttribute('tabindex', '0');
  });
});

describe('operation Canvas model', () => {
  const entries = [
    { key: 'first', operation: first },
    { key: 'second', operation: second },
  ];

  it('gives every operation one equally spaced hit cell regardless of duration or gaps', () => {
    expect(hitTestOperation(entries, 50, 300)?.operation).toBe(first);
    expect(hitTestOperation(entries, 149, 300)?.operation).toBe(first);
    expect(hitTestOperation(entries, 150, 300)?.operation).toBe(second);
    expect(hitTestOperation(entries, 250, 300)?.operation).toBe(second);
  });

  it('uses a narrow bounded gap and encodes duration in bar height', () => {
    const short = operationBarGeometry(0, 4, 400, 2, 8, 1);
    const long = operationBarGeometry(1, 4, 400, 8, 8, 1);

    expect(short.barWidth).toBe(97);
    expect(long.barX - short.barX).toBe(100);
    expect(short.barHeight).toBeLessThan(long.barHeight);
    expect(long.barHeight).toBe(86);
    expect(long.barY).toBeLessThan(short.barY);
  });

  it('reserves twenty percent of plot height exclusively for the largest operation', () => {
    const ordinary = operationBarGeometry(0, 2, 200, 8, 8, 1, 96, 0, false);
    const largest = operationBarGeometry(1, 2, 200, 9, 8, 1, 96, 0, true);

    expect(largest.barHeight - ordinary.barHeight).toBeCloseTo(17.2);
    expect(largest.barHeight / ordinary.barHeight).toBeCloseTo(1.25);
  });

  it('uses a robust duration scale that ignores one large outlier', () => {
    const ordinary = Array.from({ length: 20 }, (_, index) => ({
      ...first,
      ordinal: index,
      ref: { ...first.ref, operationId: String(index) },
      startMs: index * 10,
      endMs: index * 10 + index + 1,
    }));
    const outlier = {
      ...first,
      ordinal: 20,
      ref: { ...first.ref, operationId: 'outlier' },
      startMs: 300,
      endMs: 1300,
    };

    expect(operationDurationScaleMs([...ordinary, outlier])).toBe(20);
    expect(operationMaximumDurationMs([...ordinary, outlier])).toBe(1000);
  });

  it('keeps batch colors stable and distinguishable', () => {
    expect(operationLaneColor('0')).toBe(GROUP.gemm.color);
    expect(operationLaneColor('1')).toBe(GROUP.attn.color);
    expect(operationLaneColor('2')).toBe(GROUP.comm.color);
    expect(operationLaneColor('2')).not.toBe(operationLaneColor('4'));
  });
});
