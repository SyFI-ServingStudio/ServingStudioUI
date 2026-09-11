import type {
  AlignmentCostNode,
  AlignmentSimSlot,
  AlignmentTimelineIteration,
} from '../../artifacts/schema/alignmentTypes';
import { colorOf } from '../costTreeModel';
import { isFullViewport, spanOf, type AxisSpan } from './axisZoom';
import { forwardIdleFraction, type DutyBreakdown } from './dutyBreakdown';
import { fmtMs } from './format';
import { measuredKernelColor } from './kernelFamily';

/**
 * Geometry for the measured-against-modelled lanes.
 *
 * Both lanes are laid out in milliseconds from ONE origin — the first drawn
 * iteration's anchor, which is that rank's first kernel start. The simulated
 * lane has no timestamps of its own (a cost tree is a fold, not a schedule) so
 * its slots are placed by walking that tree from the same origin. That
 * placement is an assumption and the card says so, quoting the analyzer's own
 * `anchor_rule`.
 *
 * Kernel intervals arrive capture-absolute and are rebased here; the host
 * events beside them arrive anchor-relative already. See `hostLanes.ts`.
 */

export interface LaneBar {
  /** Stable enough for a selected occurrence across a redraw at another zoom. */
  readonly id: string;
  readonly iterationId: number;
  readonly startMs: number;
  readonly endMs: number;
  /** NSYS correlation id shared with the host CUDA runtime launch, when known. */
  readonly correlationId: number | null;
  readonly label: string;
  readonly operation: string | null;
  readonly color: string;
  readonly phase: string | null;
  readonly rowId: string | null;
  readonly slotIndex: number | null;
  readonly slotKind: string | null;
  /** Which sub-row of its lane this bar belongs on. Non-zero for work that
   * genuinely shares a span and would otherwise be drawn on top of itself: the
   * concurrent branches of a Max node on the modelled lane, and each extra CUDA
   * stream on the measured one. */
  readonly row: number;
}

const NS_PER_MS = 1e6;

/** What a bar's operation, or its kernel family, colours it. */
export interface LanePalette {
  readonly operationColors: Readonly<Record<string, string>>;
  readonly operationTypes: Readonly<Record<string, string>>;
  readonly unmappedColor: string;
}

/** Reference-rank bars of the measured lane, in start order.
 *
 * `originNs` is what the bars are measured from — the first iteration's anchor
 * when several share an axis — so a lane placed later on that axis carries its
 * own offset rather than being shifted afterwards. */
export function measuredLane(
  iteration: AlignmentTimelineIteration,
  kernelNames: Readonly<Record<number, string>>,
  referenceDeviceId: number,
  palette: LanePalette,
  originNs: number = iteration.gpuSpanNs[0],
): readonly LaneBar[] {
  const bars: LaneBar[] = [];
  for (const kernel of iteration.measured.kernels) {
    for (const [deviceId, startNs, endNs, correlationId, trackIndex] of kernel.intervals) {
      if (deviceId !== referenceDeviceId) continue;
      bars.push({
        id: `kernel:${iteration.iterationId}:${kernel.rowId}:${deviceId}:${startNs}:${endNs}`,
        iterationId: iteration.iterationId,
        // One sub-row per CUDA stream. Kernels on different streams overlap in
        // wall time, so drawing them on one row would either hide one of them
        // or read as a serialization that never happened.
        row: trackIndex ?? 0,
        startMs: (startNs - originNs) / NS_PER_MS,
        endMs: (endNs - originNs) / NS_PER_MS,
        correlationId: correlationId ?? null,
        label: kernelNames[kernel.nameId] ?? `kernel ${kernel.nameId}`,
        operation: kernel.operation,
        color:
          (kernel.operation === null ? undefined : palette.operationColors[kernel.operation]) ??
          measuredKernelColor(
            kernel.category,
            kernel.operation === null ? null : palette.operationTypes[kernel.operation],
          ),
        phase: kernel.phase,
        rowId: kernel.rowId,
        slotIndex: null,
        slotKind: null,
      });
    }
  }
  return bars.sort((left, right) => left.startMs - right.startMs);
}

/**
 * The modelled lane: the cost tree walked into placed bars.
 *
 * Unit times are used rather than folded ones because a folded slot drawn as
 * one bar would be a 32-layer body pretending to be a single kernel. The tree
 * says how to place them: a Sum lays its children in sequence, a Scale repeats
 * them, and a Max gives every branch the same start, because a Max is the model
 * saying those branches run concurrently. Flattening a Max into the sequence
 * would draw overlapped work as elapsed time — on a 4-branch tree that is twice
 * the iteration, and the lane would disagree with the modelled cycle drawn
 * around it.
 *
 * `overlap` divides the span a Max advances by, the same way the model folds
 * it; an overlap above 1 therefore leaves branches drawn wider than the span
 * they contributed, which is what more-than-serial overlap means.
 */
export function simulatedLane(
  iteration: AlignmentTimelineIteration,
  nodes: readonly AlignmentCostNode[],
  slots: readonly AlignmentSimSlot[],
  slotMultiplicity: readonly number[],
  palette: LanePalette,
  originMs = 0,
): readonly LaneBar[] {
  const bars: LaneBar[] = [];
  const leaf = (slotIndex: number, startMs: number, row: number): number => {
    const unitMs = iteration.simulated.slotMs[slotIndex];
    const slot = slots[slotIndex];
    if (unitMs === undefined || slot === undefined) return 0;
    const operation = iteration.simulated.slotOperation[slotIndex] ?? null;
    bars.push({
      id: `simulation:${iteration.iterationId}:${slotIndex}:${row}:${startMs}`,
      iterationId: iteration.iterationId,
      row,
      correlationId: null,
      startMs,
      endMs: startMs + unitMs,
      label: slot.name,
      operation,
      color:
        (operation === null ? undefined : palette.operationColors[operation]) ?? colorOf(slot.kind),
      phase: null,
      rowId: null,
      slotIndex,
      slotKind: slot.kind,
    });
    return unitMs;
  };

  if (nodes.length === 0) {
    // No manifest: the tree shape is unknown, so the only placement left is the
    // one that needs nothing but multiplicity. It is right for a Max-free tree
    // and long for any other, which the payload gives no way to detect.
    let cursorMs = originMs;
    iteration.simulated.slotMs.forEach((_unitMs, slotIndex) => {
      for (let repeat = 0; repeat < (slotMultiplicity[slotIndex] ?? 1); repeat += 1) {
        cursorMs += leaf(slotIndex, cursorMs, 0);
      }
    });
    return bars;
  }

  /** Places one node and returns the span it advances its parent by. */
  const place = (nodeIndex: number, startMs: number, row: number): number => {
    const node = nodes[nodeIndex];
    if (node === undefined) return 0;
    switch (node.kind) {
      case 'leaf':
        return leaf(node.slotIndex, startMs, row);
      case 'sum': {
        let cursorMs = startMs;
        for (let child = node.children[0]; child < node.children[1]; child += 1) {
          cursorMs += place(child, cursorMs, row);
        }
        return cursorMs - startMs;
      }
      case 'scale': {
        let cursorMs = startMs;
        for (let repeat = 0; repeat < node.repeats; repeat += 1) {
          for (let child = node.children[0]; child < node.children[1]; child += 1) {
            cursorMs += place(child, cursorMs, row);
          }
        }
        return cursorMs - startMs;
      }
      case 'max': {
        let widestMs = 0;
        for (let child = node.children[0]; child < node.children[1]; child += 1) {
          widestMs = Math.max(widestMs, place(child, startMs, row + child - node.children[0]));
        }
        return node.overlap > 0 ? widestMs / node.overlap : widestMs;
      }
    }
  };
  place(0, originMs, 0);
  return bars;
}

/** One iteration's contribution to the shared axis. */
export interface IterationLane {
  readonly role: IterationRole;
  readonly iterationId: number;
  readonly iterationType: string;
  /** Where this iteration's anchor sits on the shared axis. */
  readonly offsetMs: number;
  /** Its last measured kernel end, which is where the wall clock between it and
   * the next iteration starts. */
  readonly kernelEndMs: number;
  readonly measured: readonly LaneBar[];
  readonly simulated: readonly LaneBar[];
  readonly simulatedRowCount: number;
  readonly gaps: readonly LaneSpan[];
  readonly phaseBands: readonly PhaseBand[];
  /** Absolute on the shared axis, so the canvas draws it without arithmetic.
   * Null on the capture's last iteration, which has no next boundary. */
  readonly simulatedGpuCycleEndMs: number | null;
  readonly spanMs: number;
  readonly criticalPathMs: number;
  readonly simulatedMs: number;
  readonly idleFraction: number;
  readonly forwardIdleFraction: number | null;
  readonly gapCount: number;
}

export type IterationRole = 'before' | 'selected' | 'after';

export interface LaneSpan {
  readonly startMs: number;
  readonly endMs: number;
}

export interface PhaseBand extends LaneSpan {
  readonly phase: string;
  readonly phaseIndex: number;
}

export interface InterIterationGap extends LaneSpan {
  readonly microseconds: number;
}

export interface ContinuousScene {
  /** The axis, already padded. Opens before zero whenever a host window does:
   * a launch precedes the kernel it launches. */
  readonly startMs: number;
  readonly endMs: number;
  readonly lanes: readonly IterationLane[];
  readonly interIterationGaps: readonly InterIterationGap[];
  readonly phaseOrder: readonly string[];
  readonly selectedIndex: number;
}

export interface ContinuousSceneInput {
  readonly role: IterationRole;
  readonly iteration: AlignmentTimelineIteration;
  readonly breakdown: DutyBreakdown;
}

export interface ContinuousSceneOptions {
  readonly kernelNames: Readonly<Record<number, string>>;
  readonly referenceDeviceId: number;
  readonly slotMultiplicity: readonly number[];
  readonly slots: readonly AlignmentSimSlot[];
  readonly simNodes: readonly AlignmentCostNode[];
  readonly palette: LanePalette;
}

/**
 * Several consecutive iterations on ONE continuous axis.
 *
 * Each is placed at its own `anchor_ns`, so the space between them is real
 * captured wall clock: the gap between one iteration's last kernel and the
 * next one's first is the thing a per-iteration view cannot show at all, and
 * it is usually larger than any gap inside either of them.
 *
 * Everything is the reference rank's own clock. `measured_gpu_cycle_ms` is a
 * min-over-all-ranks quantity and would not line up with these anchors, so the
 * boundary this draws is the next iteration's anchor.
 */
export function continuousScene(
  inputs: readonly ContinuousSceneInput[],
  options: ContinuousSceneOptions,
): ContinuousScene | null {
  if (inputs.length === 0) return null;
  const originNs = inputs[0].iteration.anchorNs;
  const phaseOrder: string[] = [];

  const lanes = inputs.map((input) => {
    const { iteration, breakdown } = input;
    const offsetMs = (iteration.anchorNs - originNs) / NS_PER_MS;
    const measured = measuredLane(
      iteration,
      options.kernelNames,
      options.referenceDeviceId,
      options.palette,
      originNs,
    );
    const simulated = simulatedLane(
      iteration,
      options.simNodes,
      options.slots,
      options.slotMultiplicity,
      options.palette,
      offsetMs,
    );
    const bandByPhase = new Map<string, { startMs: number; endMs: number }>();
    for (const bar of measured) {
      if (bar.phase === null) continue;
      if (!phaseOrder.includes(bar.phase)) phaseOrder.push(bar.phase);
      const band = bandByPhase.get(bar.phase);
      if (band === undefined)
        bandByPhase.set(bar.phase, { startMs: bar.startMs, endMs: bar.endMs });
      else {
        band.startMs = Math.min(band.startMs, bar.startMs);
        band.endMs = Math.max(band.endMs, bar.endMs);
      }
    }
    return {
      role: input.role,
      iterationId: iteration.iterationId,
      iterationType: iteration.iterationType,
      offsetMs,
      kernelEndMs: (iteration.gpuSpanNs[1] - originNs) / NS_PER_MS,
      measured,
      simulated,
      simulatedRowCount: simulated.reduce((rows, bar) => Math.max(rows, bar.row + 1), 1),
      gaps: breakdown.gaps.map((gap) => ({
        startMs: (gap.startNs - originNs) / NS_PER_MS,
        endMs: (gap.endNs - originNs) / NS_PER_MS,
      })),
      phaseBands: [...bandByPhase.entries()].map(([phase, band]) => ({
        phase,
        phaseIndex: phaseOrder.indexOf(phase),
        ...band,
      })),
      simulatedGpuCycleEndMs:
        iteration.simulatedGpuCycleMs === null ? null : offsetMs + iteration.simulatedGpuCycleMs,
      spanMs: breakdown.spanMs,
      criticalPathMs: iteration.measured.criticalPathMs,
      simulatedMs: iteration.simulated.totalMs,
      idleFraction: breakdown.spanMs > 0 ? breakdown.idleMs / breakdown.spanMs : 0,
      forwardIdleFraction: forwardIdleFraction(breakdown),
      gapCount: breakdown.gaps.length,
    };
  });

  const interIterationGaps: InterIterationGap[] = [];
  for (let index = 0; index < lanes.length - 1; index += 1) {
    const startMs = lanes[index].kernelEndMs;
    const endMs = lanes[index + 1].offsetMs;
    if (endMs <= startMs) continue;
    interIterationGaps.push({ startMs, endMs, microseconds: (endMs - startMs) * 1000 });
  }

  let startMs = 0;
  let endMs = lanes.reduce(
    (latest, lane) => Math.max(latest, lane.kernelEndMs, lane.simulatedGpuCycleEndMs ?? 0),
    0,
  );
  // Each iteration's DECLARED host window, not the extent of every row that
  // touched it: the load generator's `execute_context` marks span many
  // iterations and would stretch the axis by tens of milliseconds to hold a bar
  // with nothing under it. Rows past the window are clipped, not dropped.
  for (const input of inputs) {
    const window = input.iteration.host?.windowNs;
    if (window === undefined) continue;
    const offsetMs = (input.iteration.anchorNs - originNs) / NS_PER_MS;
    startMs = Math.min(startMs, offsetMs + window[0] / NS_PER_MS);
    endMs = Math.max(endMs, offsetMs + window[1] / NS_PER_MS);
  }
  const pad = (endMs - startMs) * 0.01;
  const selectedIndex = Math.max(
    0,
    lanes.findIndex((lane) => lane.role === 'selected'),
  );
  return {
    startMs: startMs - pad,
    endMs: endMs + pad,
    lanes,
    interIterationGaps,
    phaseOrder,
    selectedIndex,
  };
}

/** The full extent of the shared axis, which is what a zoom gesture may move
 * inside and may not leave. */
export const sceneDomain = (scene: ContinuousScene): AxisSpan => ({
  start: scene.startMs,
  end: scene.endMs,
});

/**
 * What the shared axis currently spans.
 *
 * The positions are offsets from the first drawn iteration's anchor, not
 * capture-absolute timestamps, so the window is stated as a range on that axis
 * and against the width of the whole one — a bare pair of numbers here would
 * read as wall-clock times the capture never recorded.
 */
export function axisWindowNote(scene: ContinuousScene, viewport: AxisSpan): string {
  const domain = sceneDomain(scene);
  if (isFullViewport(viewport, domain)) {
    return `x axis · the whole ${fmtMs(spanOf(domain))} drawn on it`;
  }
  return `x axis · ${fmtMs(viewport.start)} … ${fmtMs(viewport.end)} of ${fmtMs(spanOf(domain))}`;
}

/** Round axis values at a 1/2/2.5/5 step, so a reader reads "10 ms" rather
 * than "9.7 ms". */
export function niceTicks(low: number, high: number, count: number): readonly number[] {
  const span = high - low;
  if (!(span > 0) || count <= 0) return [low];
  const raw = span / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const step =
    [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= raw) ??
    10 * magnitude;
  const ticks: number[] = [];
  for (let value = Math.ceil(low / step) * step; value <= high + step * 1e-9; value += step) {
    ticks.push(value);
  }
  return ticks;
}

/** Bars narrower than one pixel are counted, not drawn: at this zoom drawing
 * every one turns the lane into a solid band and the count is the honest
 * statement of what was left out. */
export function visibleBars<Bar extends { startMs: number; endMs: number }>(
  bars: readonly Bar[],
  domainMs: number,
  plotWidthPx: number,
  minimumPx = 1,
): { readonly drawn: readonly Bar[]; readonly omitted: number } {
  if (domainMs <= 0 || plotWidthPx <= 0) return { drawn: bars, omitted: 0 };
  const pxPerMs = plotWidthPx / domainMs;
  const drawn = bars.filter((bar) => (bar.endMs - bar.startMs) * pxPerMs >= minimumPx);
  return { drawn, omitted: bars.length - drawn.length };
}
