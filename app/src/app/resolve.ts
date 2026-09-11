/**
 * What a result address renders.
 *
 * It lives here, above both, because it is the one question that needs the
 * registry *and* the layout: the layout says which panels a kind shows and in
 * what order, and the registry says which of those exist in this build and
 * apply at this depth.
 *
 * The answer is deliberately not "the panel component". Nothing is loaded to
 * decide this — a panel id and a section title are enough — so the shell can
 * render its structure before any panel chunk has arrived.
 */
import { frameOf, layoutFor, rowsOf, sectionsOf } from '../layouts';
import type { SectionControl } from '../layouts';
import { appliesAt, appliesTo, missingSegments, panelSpec } from '../panels/registry';
import type { ContentPanelSpec } from '../panels/types';
import {
  alignmentBreakdownRef,
  alignmentDescriptorRef,
  alignmentE2eSeriesRef,
  alignmentIterationReportRef,
  alignmentIterationSeriesRef,
  alignmentTimelineIndexRef,
  alignmentTimelineIterationRef,
  alignmentWorkloadSeriesRef,
  catalogRef,
  fetchSequence,
  kernelInputDistributionRef,
  kernelThroughputAnalysisRef,
  operationsSeqRef,
  predictionCasesRef,
  predictionCostTreeRef,
  predictionDescriptorRef,
  predictionKernelThroughputAnalysisRef,
  predictionOptimalityKernelLadderRef,
  predictionOptimalityWaterfallRef,
  readArtifact,
  readKey,
  runDescriptorRef,
  sweepAnalysisRef,
  workerCostTreeRef,
  type ReadRef,
} from '../artifacts';
import { segmentOf, type Location } from '../location';
import { annotate, leafById, nodeById } from '../panels/costTreeModel';
import { metricStatisticLabel, sweepMetricSections } from '../panels/sweep/metricSections';

export interface ResolvedSection {
  readonly title: string;
  readonly heading?: boolean;
  readonly frame: {
    readonly idx: string;
    readonly title: string;
    readonly sub?: string;
    readonly accent: 'analysis' | 'structure' | 'optimality';
    readonly control: SectionControl | null;
  } | null;
  readonly spacing?: number;
  readonly panels: readonly ContentPanelSpec[];
  readonly rows: readonly (readonly ContentPanelSpec[])[];
}

export type Resolution =
  | {
      readonly status: 'unaddressable';
      readonly outcome: 'not-found' | 'unavailable';
      readonly reason: string;
    }
  | { readonly status: 'panel'; readonly panel: ContentPanelSpec }
  | { readonly status: 'page'; readonly sections: readonly ResolvedSection[] };

/**
 * One panel when the address names a standalone panel; the selected page
 * layout when it names a page mode; otherwise the default page.
 *
 * Most `panel=` values are requests to look at one thing, so a shared citation
 * lands on that panel alone. A page-mode spec is different by declaration: it
 * selects a layout whose surrounding context is part of the interaction.
 *
 * A `panel=` this build cannot honour is reported, not silently replaced by the
 * page: the reader followed a link to something specific, and quietly showing
 * them something else is how a stale citation becomes impossible to notice.
 */
export function resolveResult(location: Extract<Location, { view: 'result' }>): Resolution {
  const focus = location.focus;
  if (focus.panel !== null) {
    const spec = panelSpec(focus.panel);
    if (spec === null) {
      return {
        status: 'unaddressable',
        outcome: 'not-found',
        reason: `This build has no panel called "${focus.panel}".`,
      };
    }
    // Kind before path, because they are not the same disappointment. A missing
    // segment is something the reader can go and open; the wrong kind of result
    // never becomes right, and saying "needs a pool on the path" about a
    // prediction would send them looking for one.
    if (!appliesTo(spec, location.ref.kind)) {
      return {
        status: 'unaddressable',
        outcome: 'not-found',
        reason: `The panel "${spec.id}" is about ${spec.kinds.join(' and ')} results, and this address names a ${location.ref.kind}.`,
      };
    }
    const missing = missingSegments(spec, focus);
    if (missing.length > 0) {
      return {
        status: 'unaddressable',
        outcome: 'not-found',
        reason: `The panel "${spec.id}" needs ${spec.consumes.join(' and ')} on the path, and this address does not name ${missing.join(' or ')}.`,
      };
    }
    if (spec.mode === 'panel') return { status: 'panel', panel: spec };
    return resolvePage(location, spec.layoutMode);
  }
  return resolvePage(location);
}

function resolvePage(
  location: Extract<Location, { view: 'result' }>,
  layoutMode?: string,
): Resolution {
  const focus = location.focus;
  const layout = layoutFor(location.ref.kind);
  if (layout === null) {
    return {
      status: 'unaddressable',
      outcome: 'unavailable',
      reason: `Results of kind "${location.ref.kind}" have not been ported to this build yet.`,
    };
  }
  const layoutSections = sectionsOf(layout, layoutMode);
  if (layoutSections === null) {
    return {
      status: 'unaddressable',
      outcome: 'not-found',
      reason: `The layout for ${location.ref.kind} results has no mode called "${layoutMode}".`,
    };
  }
  const sections = layoutSections
    .map((section) => {
      const rows = rowsOf(section, focus)
        .map((row) =>
          row
            .map((id) => panelSpec(id))
            .filter(
              (spec): spec is ContentPanelSpec =>
                spec !== null && spec.mode === 'panel' && appliesAt(spec, location.ref.kind, focus),
            ),
        )
        .filter((row) => row.length > 0);
      return {
        title: section.title,
        heading: section.heading,
        frame: frameOf(section, focus),
        spacing: section.spacing,
        rows,
        panels: rows.flat(),
      };
    })
    .filter((section) => section.panels.length > 0);
  return { status: 'page', sections };
}

export type LocationResolution = 'ok' | 'not-found' | 'unavailable';

async function resolveRead(ref: ReadRef, signal?: AbortSignal): Promise<LocationResolution> {
  const result =
    'seq' in ref
      ? await fetchSequence(ref, { mode: 'range', offset: 0, limit: 1 }, signal)
      : await readArtifact(ref, signal);
  return result.status === 'ready' ? 'ok' : 'unavailable';
}

function readsForResolution(
  location: Extract<Location, { view: 'result' }>,
  resolution: Exclude<Resolution, { status: 'unaddressable' }>,
): readonly ReadRef[] {
  const specs =
    resolution.status === 'panel'
      ? [resolution.panel]
      : resolution.sections.flatMap((section) => section.panels);
  const selector = location.focus.panel === null ? null : panelSpec(location.focus.panel);
  const refs = [...specs, ...(selector === null ? [] : [selector])].flatMap((spec) =>
    spec.needs(location),
  );
  return [...new Map(refs.map((ref) => [readKey(ref), ref])).values()];
}

async function resolveWorkerWorkbench(
  location: Extract<Location, { view: 'result' }>,
  signal?: AbortSignal,
): Promise<LocationResolution> {
  if (location.ref.kind !== 'run' || location.focus.panel !== 'worker.cost-tree') return 'ok';

  const runRef = { ...location.ref, kind: 'run' as const };
  const descriptor = await readArtifact(runDescriptorRef(runRef), signal);
  if (descriptor.status !== 'ready') return 'unavailable';
  const revision = descriptor.value.analysis?.revision;
  if (
    revision === undefined ||
    descriptor.value.details['worker-operation-index']?.status !== 'ready'
  ) {
    return 'unavailable';
  }

  const pinned = { ...runRef, revision };
  const sequence = operationsSeqRef(pinned, location.focus.path);
  const sequenceRequest =
    segmentOf(location.focus.path, 'operation') === null && location.focus.cursorMs !== null
      ? ({ mode: 'seek', atMs: location.focus.cursorMs } as const)
      : ({ mode: 'range', offset: 0, limit: 1 } as const);
  const sequenceResult = await fetchSequence(sequence, sequenceRequest, signal);
  if (sequenceResult.status !== 'ready') return 'unavailable';

  const operation = segmentOf(location.focus.path, 'operation');
  if (operation === null) return 'ok';
  if (descriptor.value.details['worker-cost-tree']?.status !== 'ready') return 'unavailable';
  const tree = await readArtifact(workerCostTreeRef(pinned, location.focus.path), signal);
  if (tree.status !== 'ready') return 'unavailable';

  const leaf = segmentOf(location.focus.path, 'leaf');
  if (leaf === null) return 'ok';
  const analysis = await readArtifact(
    kernelThroughputAnalysisRef(pinned, location.focus.path),
    signal,
  );
  if (analysis.status !== 'ready') return 'unavailable';
  const distributionCapability = descriptor.value.subjects.kernelInputDistribution;
  if (distributionCapability?.status !== 'ready') return 'ok';
  const distribution = await readArtifact(kernelInputDistributionRef(pinned), signal);
  return distribution.status === 'ready' &&
    distribution.schemaVersion === distributionCapability.schemaVersion
    ? 'ok'
    : 'unavailable';
}

async function resolvePredictionPage(
  location: Extract<Location, { view: 'result' }>,
  signal?: AbortSignal,
): Promise<LocationResolution> {
  if (location.ref.kind !== 'prediction') return 'ok';
  const result = { ...location.ref, kind: 'prediction' as const };
  const descriptor = await readArtifact(predictionDescriptorRef(result), signal);
  if (descriptor.status !== 'ready') return 'unavailable';
  const selectedCase = segmentOf(location.focus.path, 'case');
  if (selectedCase === null) return 'ok';
  const numericCase = Number(selectedCase.id);
  const offset =
    Number.isSafeInteger(numericCase) && numericCase >= 0 ? Math.floor(numericCase / 64) * 64 : 0;
  const cases = await readArtifact(predictionCasesRef(result, offset, 64), signal);
  if (cases.status !== 'ready') return 'unavailable';
  const predictionCase = cases.value.cases.find(
    (candidate) => candidate.caseId === selectedCase.id,
  );
  if (predictionCase === undefined) return 'not-found';
  const mode = location.focus.options.optimality === 'batch_locked' ? 'batch_locked' : 'unlocked';
  const target = location.focus.panel;
  const selectedOperation = segmentOf(location.focus.path, 'caseOperation');
  const resolveTargetOptimality = async (): Promise<LocationResolution> => {
    if (target === 'optimality-breakdown') {
      const waterfall = await readArtifact(
        predictionOptimalityWaterfallRef(result, selectedCase.id, mode),
        signal,
      );
      return waterfall.status === 'ready' ? 'ok' : 'unavailable';
    }
    if (target === 'optimality-kernel-ladder' || target === 'optimality-kernels') {
      const ladder = await readArtifact(
        predictionOptimalityKernelLadderRef(result, selectedCase.id, mode),
        signal,
      );
      return ladder.status === 'ready' ? 'ok' : 'unavailable';
    }
    return 'ok';
  };
  if (selectedOperation === null) return resolveTargetOptimality();
  if (
    !predictionCase.operations.some((operation) => operation.operationId === selectedOperation.id)
  ) {
    return 'not-found';
  }
  const tree = await readArtifact(
    predictionCostTreeRef(result, selectedCase.id, selectedOperation.id),
    signal,
  );
  if (tree.status !== 'ready') return 'unavailable';
  const annotated = annotate(tree.value.tree);
  const leaf = segmentOf(location.focus.path, 'leaf');
  const parallel = segmentOf(location.focus.path, 'parallel');
  if (leaf !== null && leafById(annotated, leaf.id) === null) return 'not-found';
  if (parallel !== null && nodeById(annotated, parallel.id)?.kind !== 'max') return 'not-found';
  if (
    target === 'optimality-breakdown' ||
    target === 'optimality-kernel-ladder' ||
    target === 'optimality-kernels'
  ) {
    return resolveTargetOptimality();
  }
  if (leaf === null || target === 'cost-tree') return 'ok';
  if (target === 'kernel-time-share') return 'ok';
  if (target === 'kernel-input-distribution') {
    if (!descriptor.value.kernelInputDistributionAvailable) return 'unavailable';
    const distribution = await readArtifact(kernelInputDistributionRef(result), signal);
    return distribution.status === 'ready' ? 'ok' : 'unavailable';
  }
  const analysis = await readArtifact(
    predictionKernelThroughputAnalysisRef(result, selectedCase.id, selectedOperation.id, leaf.id),
    signal,
  );
  if (analysis.status !== 'ready') return 'unavailable';
  return 'ok';
}

function equalCoordinates(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): boolean {
  const keys = Object.keys(left).sort();
  const other = Object.keys(right).sort();
  return (
    keys.length === other.length &&
    keys.every(
      (key, index) =>
        key === other[index] && JSON.stringify(left[key]) === JSON.stringify(right[key]),
    )
  );
}

async function resolveSweepPage(
  location: Extract<Location, { view: 'result' }>,
  signal?: AbortSignal,
): Promise<LocationResolution> {
  if (location.ref.kind !== 'sweep') return 'ok';
  const payload = await readArtifact(
    sweepAnalysisRef({ ...location.ref, kind: 'sweep' as const }),
    signal,
  );
  if (payload.status !== 'ready') return 'unavailable';
  const panels = sweepMetricSections(payload.value.metrics).flatMap((section) => section.panels);
  const panelId = location.focus.options['evidence-panel'];
  const metricKey = location.focus.options.metric;
  const statistic = location.focus.options.stat;
  const panel =
    (panelId === undefined ? undefined : panels.find((candidate) => candidate.id === panelId)) ??
    (metricKey === undefined
      ? undefined
      : panels.find((candidate) => candidate.metrics.some((metric) => metric.key === metricKey)));
  if ((panelId !== undefined || metricKey !== undefined || statistic !== undefined) && !panel) {
    return 'not-found';
  }
  if (metricKey !== undefined && !panel?.metrics.some((metric) => metric.key === metricKey)) {
    return 'not-found';
  }
  if (
    statistic !== undefined &&
    ((statistic !== 'mean' && statistic !== 'p99') ||
      !panel?.metrics.some((metric) => metricStatisticLabel(metric)?.toLowerCase() === statistic))
  ) {
    return 'not-found';
  }
  const member = segmentOf(location.focus.path, 'run');
  if (
    member !== null &&
    !payload.value.runs.some(
      (run) =>
        (member.id === undefined || run.runId === member.id) &&
        (member.coordinates === undefined || equalCoordinates(run.coordinates, member.coordinates)),
    )
  ) {
    return 'not-found';
  }
  return 'ok';
}

/** Resolve only the subjects the alignment descriptor says exist.
 *
 * Partial bundles are a normal producer state: kernel analysis and end-to-end
 * analysis finish independently. Reading a known-absent subject would turn
 * that state into an apparent transport failure. */
async function resolveAlignmentPage(
  location: Extract<Location, { view: 'result' }>,
  signal?: AbortSignal,
): Promise<LocationResolution> {
  if (location.ref.kind !== 'alignment') return 'ok';
  const result = { ...location.ref, kind: 'alignment' as const };
  const descriptor = await readArtifact(alignmentDescriptorRef(result), signal);
  if (descriptor.status !== 'ready') return 'unavailable';

  const ready = (subject: keyof typeof descriptor.value.subjects) =>
    descriptor.value.subjects[subject].status === 'ready';
  const selected = segmentOf(location.focus.path, 'iteration')?.id ?? null;
  let selectedExists = selected === null;
  let iterationContainsSelection = false;
  let timelineContainsSelection = false;

  if (ready('iteration')) {
    const [report, series] = await Promise.all([
      readArtifact(alignmentIterationReportRef(result), signal),
      readArtifact(alignmentIterationSeriesRef(result), signal),
    ]);
    if (report.status !== 'ready' || series.status !== 'ready') return 'unavailable';
    if (selected !== null) {
      iterationContainsSelection =
        report.value.iterations.some((row) => row.iterationId === selected) ||
        series.value.iterations.some((row) => row.iterationId === selected);
      selectedExists ||= iterationContainsSelection;
    }
  }

  if (ready('timeline')) {
    const timeline = await readArtifact(alignmentTimelineIndexRef(result), signal);
    if (timeline.status !== 'ready') return 'unavailable';
    if (selected !== null) {
      timelineContainsSelection = timeline.value.iterations.some(
        (row) => row.iterationId === selected,
      );
      selectedExists ||= timelineContainsSelection;
    }
  }

  if (!selectedExists) return 'not-found';
  const detailReads =
    selected === null
      ? []
      : [
          ...(iterationContainsSelection && descriptor.value.subjects.iteration.hasIterationDetail
            ? [alignmentBreakdownRef(result, selected)]
            : []),
          ...(timelineContainsSelection && descriptor.value.subjects.timeline.hasIterationDetail
            ? [alignmentTimelineIterationRef(result, selected)]
            : []),
        ];
  const details = await Promise.all(detailReads.map((ref) => readArtifact(ref, signal)));
  if (!details.every((artifact) => artifact.status === 'ready')) return 'unavailable';
  const optionalReads = [
    ...(ready('workload') ? [alignmentWorkloadSeriesRef(result)] : []),
    ...(ready('e2e') ? [alignmentE2eSeriesRef(result)] : []),
  ];
  const optional = await Promise.all(optionalReads.map((ref) => readArtifact(ref, signal)));
  return optional.every((artifact) => artifact.status === 'ready') ? 'ok' : 'unavailable';
}

/**
 * Resolve an address before a citation commits it.
 *
 * Structure answers whether this build understands the destination. The
 * catalog then proves the result exists and is browseable. A citation to one
 * named panel additionally resolves every artifact that panel declares in
 * `needs`. A page-mode citation resolves the needs of the panels it will mount,
 * including revision-pinned dependent reads in the worker workbench.
 */
export async function resolveLocation(
  location: Location,
  signal?: AbortSignal,
): Promise<LocationResolution> {
  if (location.view !== 'result') return 'ok';
  const structural = resolveResult(location);
  if (structural.status === 'unaddressable') return structural.outcome;

  const catalog = await readArtifact(catalogRef(location.ref.workspace, location.ref.kind), signal);
  if (catalog.status !== 'ready') return 'unavailable';
  const entry = catalog.value.find(
    (candidate) =>
      candidate.workspace === location.ref.workspace && candidate.id === location.ref.id,
  );
  if (entry === undefined) return 'not-found';
  if (entry.status !== 'ready' && entry.status !== 'partial') return 'unavailable';

  if (location.ref.kind === 'alignment') return resolveAlignmentPage(location, signal);
  if (location.focus.panel === null) return 'ok';
  if (location.ref.kind === 'sweep') return resolveSweepPage(location, signal);
  const results = await Promise.all(
    readsForResolution(location, structural).map((ref) => resolveRead(ref, signal)),
  );
  if (!results.every((status) => status === 'ok')) return 'unavailable';
  const worker = await resolveWorkerWorkbench(location, signal);
  return worker === 'ok' ? resolvePredictionPage(location, signal) : worker;
}
