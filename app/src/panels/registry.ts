/**
 * Every panel this build has, by id.
 *
 * The registry is the authority for what a `panel=` in a URL may name, so a
 * stale link or an old citation resolves to "no such panel" here rather than
 * rendering something arbitrary. It is also the only place that knows the whole
 * set: which panels apply at a given drill-down, and which `focus.options` keys
 * have an owner, are questions answered by reading this table.
 *
 * It imports specs, never components. Every content spec's `load` is a dynamic
 * import; a page-mode spec selects a layout and has no component to import.
 */
import { poolBatchSpec, workerBatchSpec } from './batch/spec';
import { runConservationSpec } from './conservation/spec';
import { workerCostTreePageSpec } from './costTree/spec';
import { poolKernelTimeSpec, runKernelTimeSpec } from './kernelTime/spec';
import {
  kernelMeasurementPageSpec,
  kernelMeasurementPlotModeSpec,
  kernelMeasurementSummaryModeSpec,
} from './kernelMeasurement/spec';
import { kernelProfileCurveModeSpec, kernelProfilePageSpec } from './kernelProfile/spec';
import { predictionPageModes, predictionPageSpec } from './prediction/spec';
import { poolMemorySpec, workerMemorySpec } from './memory/spec';
import { workerIterationWorkbenchSpec } from './operationTimeline/spec';
import { runOptimalitySpec } from './optimality/spec';
import {
  poolRequestStateSpec,
  runRequestStateSpec,
  workerRequestStateSpec,
} from './requestState/spec';
import { runHeadlineSpec } from './run/spec';
import { runSloSpec } from './slo/spec';
import { runThroughputSpec } from './throughput/spec';
import { runTimelineSpec } from './timeline';
import { systemMapSpec } from './systemMap/spec';
import { sweepPageSpec } from './sweep/spec';
import { alignmentPageSpec } from './alignment/spec';
import { poolUtilizationSpec, runUtilizationSpec, workerUtilizationSpec } from './utilization/spec';
import { workerKernelTimeShareSpec } from './worker/spec';
import type { ContentPanelSpec, PanelSpec } from './types';
import type { Focus, ResultKind, SegmentKind } from '../location';

// Ordered as a reader descends: the run, where it ran, then each depth of the
// drill-down. `panelsAt` preserves this, so a section that asks for "whatever
// applies here" gets them in that order rather than in import order.
const SPECS: readonly PanelSpec[] = [
  runHeadlineSpec,
  runSloSpec,
  runThroughputSpec,
  systemMapSpec,
  runTimelineSpec,
  runUtilizationSpec,
  runConservationSpec,
  runRequestStateSpec,
  runKernelTimeSpec,
  runOptimalitySpec,
  poolUtilizationSpec,
  poolMemorySpec,
  poolBatchSpec,
  poolRequestStateSpec,
  poolKernelTimeSpec,
  workerUtilizationSpec,
  workerMemorySpec,
  workerBatchSpec,
  workerRequestStateSpec,
  workerKernelTimeShareSpec,
  workerIterationWorkbenchSpec,
  workerCostTreePageSpec,
  kernelProfilePageSpec,
  kernelProfileCurveModeSpec,
  kernelMeasurementPageSpec,
  kernelMeasurementSummaryModeSpec,
  kernelMeasurementPlotModeSpec,
  predictionPageSpec,
  ...predictionPageModes,
  sweepPageSpec,
  alignmentPageSpec,
];

const BY_ID: ReadonlyMap<string, PanelSpec> = new Map(SPECS.map((spec) => [spec.id, spec]));

/**
 * The panel of that name, or `null` when this build has none.
 *
 * `null` is the whole of "this build does not know that id" — there is no
 * separate predicate, because a caller that asked whether an id was known
 * always went on to fetch the spec, and two ways of asking the same question
 * are two things that can disagree after a panel is added.
 */
export function panelSpec(id: string): PanelSpec | null {
  return BY_ID.get(id) ?? null;
}

/**
 * Every panel this build has.
 *
 * For the registry's own invariants — that each spec is filed under its own id,
 * that every option key is spellable in a URL, and that the set of keys is
 * complete — which are properties of the whole list and cannot be checked one
 * panel at a time.
 *
 * Uniqueness of an option key is *not* among them. `run.queue` and `pool.queue`
 * share `queue` deliberately: it is one choice about one panel that renders at
 * two depths, and two keys would put the reader back on the average the moment
 * they opened a pool. Rendering never uses this list — what may be shown at an
 * address is `panelsAt`.
 */
export function allPanels(): readonly PanelSpec[] {
  return SPECS;
}

/**
 * What a panel needs that this address does not name.
 *
 * The path half of applicability: a panel that consumes a worker needs a worker
 * segment. `appliesAt` is the whole rule — a panel must also be about this kind
 * of result — and the two are separate because they fail differently, which
 * `resolveResult` has to explain. Both are properties of the address, so both
 * are settled before anything is loaded or fetched: a panel is never mounted
 * only to discover it has nothing to stand on.
 *
 * The one place that decides it. There were three — the registry filtering, the
 * commit point pruning, the resolver both filtering and explaining — and a rule
 * written out three times is three chances for a panel to be offered in one
 * place and refused in another. The missing segments are returned rather than a
 * boolean because the resolver has to name them.
 */
export function missingSegments(spec: PanelSpec, focus: Focus): readonly SegmentKind[] {
  const present = new Set<SegmentKind>(focus.path.map((segment) => segment.at));
  return spec.consumes.filter((kind) => !present.has(kind));
}

/**
 * Whether a panel is about this kind of result at all.
 *
 * Separate from the path question because the two fail differently and a reader
 * has to be told which: a panel that needs a worker becomes available by opening
 * one, and a panel that is about measured runs never becomes available on a
 * prediction. Without it, `?panel=run.system-map` on a prediction mounts the map
 * and asks the prediction for a run's topology.
 */
export function appliesTo(spec: PanelSpec, kind: ResultKind): boolean {
  return spec.kinds.includes(kind);
}

/** Whether a panel can render on this result, at this focus. */
export function appliesAt(spec: PanelSpec, kind: ResultKind, focus: Focus): boolean {
  return appliesTo(spec, kind) && missingSegments(spec, focus).length === 0;
}

/** The panels that can render here, in registry order. */
export function panelsAt(kind: ResultKind, focus: Focus): readonly ContentPanelSpec[] {
  return SPECS.filter(
    (spec): spec is ContentPanelSpec =>
      spec.mode === 'panel' && spec.scope !== false && appliesAt(spec, kind, focus),
  );
}

/** Every option key some panel claims. A key outside this set has no owner. */
export function claimedOptions(): ReadonlySet<string> {
  return new Set(SPECS.flatMap((spec) => [...spec.options]));
}
