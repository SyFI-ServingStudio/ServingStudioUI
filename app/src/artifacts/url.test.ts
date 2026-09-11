import { describe, expect, it } from 'vitest';

import { resultKindSchema, type ResultRef } from '../location';
import {
  alignmentBreakdownRef,
  alignmentDescriptorRef,
  alignmentE2eSeriesRef,
  alignmentIterationReportRef,
  alignmentIterationSeriesRef,
  alignmentSequenceRef,
  alignmentTimelineIndexRef,
  alignmentTimelineIterationRef,
  alignmentWorkloadSeriesRef,
  artifactKey,
  isAlignmentTimelineArtifactKey,
  batchCompositionRef,
  batchSeriesRef,
  catalogRef,
  kernelInputDistributionRef,
  iterationOptimalityKernelLadderRef,
  iterationOptimalityWaterfallRef,
  hardwareGpuRef,
  kernelMeasurementDescriptorRef,
  kernelMeasurementSummaryRef,
  kernelProfileCurveRef,
  kernelProfileDescriptorRef,
  kernelThroughputAnalysisRef,
  kernelTimeShareRef,
  kvOccupancyRef,
  kvOccupancySeriesRef,
  requestStateRef,
  requestStateSeriesRef,
  utilizationRef,
  utilizationSeriesRef,
  runThroughputRef,
  runConcurrencyRef,
  runDescriptorRef,
  runOptimalityRef,
  scopedOptimalityRef,
  runWorkloadRef,
  operationsSeqRef,
  predictionCasesRef,
  predictionCostTreeRef,
  predictionDescriptorRef,
  predictionKernelThroughputAnalysisRef,
  predictionOptimalityKernelLadderRef,
  predictionOptimalityWaterfallRef,
  sequenceKey,
  sequenceReadKey,
  sweepAnalysisRef,
  throughputSeriesRef,
  workerKernelTimeShareRef,
  workerCostTreeRef,
  type KernelProfileCurveRef,
} from './ref';
import { artifactUrl, sequenceUrl } from './url';

const RUN = { kind: 'run', id: '20260715_1_test', workspace: 'w_main' } satisfies ResultRef;
const SWEEP = { kind: 'sweep', id: 's_test', workspace: 'w_main' } satisfies ResultRef;
const ALIGNMENT = { kind: 'alignment', id: 'al_one', workspace: 'w_main' } satisfies ResultRef;

function descriptorRefTypeCheck(): void {
  const prediction = {
    kind: 'prediction',
    id: 'prediction-1',
    workspace: 'w_main',
  } satisfies ResultRef;
  // @ts-expect-error A prediction descriptor has a different wire contract.
  runDescriptorRef(prediction);
}

function operationSequenceTypeCheck(): void {
  const prediction = {
    kind: 'prediction',
    id: 'prediction-1',
    workspace: 'w_main',
  } satisfies ResultRef;
  // @ts-expect-error A prediction has cases, not measured worker operations.
  operationsSeqRef(prediction, [
    { at: 'pool', role: 'attn' },
    { at: 'worker', id: '0' },
  ]);
}

function offlineRevisionTypeCheck(): void {
  const result = { kind: 'kernelProfile', id: 'kp_one', workspace: 'w_main' } as const;
  const ref: KernelProfileCurveRef = {
    kind: 'kernelProfileCurve',
    // @ts-expect-error Current offline routes cannot identify a historical revision.
    result: { ...result, revision: 'old' },
  };
  void ref;
}

describe('artifactUrl', () => {
  it('restricts the run descriptor constructor at compile time', () => {
    expect(descriptorRefTypeCheck).toBeTypeOf('function');
  });
  it('restricts worker operation sequences to measured runs at compile time', () => {
    expect(operationSequenceTypeCheck).toBeTypeOf('function');
  });
  it('forbids a revision on directly constructed offline refs at compile time', () => {
    expect(offlineRevisionTypeCheck).toBeTypeOf('function');
  });
  it('addresses every result kind', () => {
    const urls = resultKindSchema.options.map((kind) => artifactUrl(catalogRef('w_main', kind)));
    // In canonical kind order, which puts sweeps before runs.
    expect(urls).toEqual([
      '/api/analyzer/v1/sweeps',
      '/api/analyzer/v1/runs',
      '/api/analyzer/v1/predictions',
      '/api/analyzer/v1/alignments',
      '/api/analyzer/v1/kernel-profiles',
      '/api/analyzer/v1/kernel-measurements',
    ]);
  });

  it('addresses profile, measurement, and hardware documents without legacy repositories', () => {
    const profile = { ...RUN, kind: 'kernelProfile' as const, id: 'kp_one' };
    const measurement = { ...RUN, kind: 'kernelMeasurement' as const, id: 'km_one' };
    expect(artifactUrl(kernelProfileDescriptorRef(profile))).toBe(
      '/api/analyzer/v1/kernel-profiles/kp_one/descriptor',
    );
    const profileCurve = kernelProfileCurveRef({ ...profile, revision: 'r 2' });
    expect(artifactUrl(profileCurve)).toBe(
      '/api/analyzer/v1/kernel-profiles/kp_one/subjects/curve/payload',
    );
    expect(artifactKey(profileCurve)).toBe(artifactKey(kernelProfileCurveRef(profile)));
    expect(artifactUrl(kernelMeasurementDescriptorRef(measurement))).toBe(
      '/api/analyzer/v1/kernel-measurements/km_one/descriptor',
    );
    expect(artifactUrl(kernelMeasurementSummaryRef(measurement))).toBe(
      '/api/analyzer/v1/kernel-measurements/km_one/subjects/summary/report',
    );
    expect(artifactUrl(hardwareGpuRef('NVIDIA H200 SXM'))).toBe(
      '/api/analyzer/v1/hardware/gpus?name=NVIDIA%20H200%20SXM',
    );
  });

  it('addresses every prediction document with paging, mode, and revision intact', () => {
    const prediction = {
      kind: 'prediction' as const,
      id: 'p_one',
      workspace: 'w_main',
      revision: 'analysis 2',
    };
    expect(artifactUrl(predictionDescriptorRef(prediction))).toBe(
      '/api/analyzer/v1/predictions/p_one/descriptor?rev=analysis%202',
    );
    expect(artifactUrl(predictionCasesRef(prediction, 64, 64))).toBe(
      '/api/analyzer/v1/predictions/p_one/subjects/cases/payload?offset=64&limit=64&rev=analysis%202',
    );
    expect(artifactUrl(predictionCostTreeRef(prediction, '65', '2'))).toBe(
      '/api/analyzer/v1/predictions/p_one/cases/65/operations/2/subjects/cost-tree/payload?rev=analysis%202',
    );
    expect(artifactUrl(predictionKernelThroughputAnalysisRef(prediction, '65', '2', 7))).toBe(
      '/api/analyzer/v1/predictions/p_one/cases/65/operations/2/leaves/7/subjects/kernel-throughput-analysis/payload?rev=analysis%202',
    );
    expect(artifactUrl(predictionOptimalityKernelLadderRef(prediction, '65', 'batch_locked'))).toBe(
      '/api/analyzer/v1/predictions/p_one/cases/65/subjects/optimality-kernel-ladder/payload?mode=batch_locked&rev=analysis%202',
    );
    expect(artifactUrl(predictionOptimalityWaterfallRef(prediction, '65', 'unlocked'))).toBe(
      '/api/analyzer/v1/predictions/p_one/cases/65/subjects/optimality-waterfall/payload?mode=unlocked&rev=analysis%202',
    );
  });

  it('addresses every alignment document and exact detail route', () => {
    const alignment = { ...ALIGNMENT, revision: 'analysis 2' };
    expect(artifactUrl(alignmentDescriptorRef(alignment))).toBe(
      '/api/analyzer/v1/alignments/al_one/descriptor?rev=analysis%202',
    );
    expect(artifactUrl(alignmentIterationReportRef(alignment))).toBe(
      '/api/analyzer/v1/alignments/al_one/subjects/iteration/report?rev=analysis%202',
    );
    expect(artifactUrl(alignmentIterationSeriesRef(alignment))).toBe(
      '/api/analyzer/v1/alignments/al_one/subjects/iteration/payload?rev=analysis%202',
    );
    expect(artifactUrl(alignmentTimelineIndexRef(alignment))).toBe(
      '/api/analyzer/v1/alignments/al_one/subjects/timeline/payload?rev=analysis%202',
    );
    expect(artifactUrl(alignmentWorkloadSeriesRef(alignment))).toBe(
      '/api/analyzer/v1/alignments/al_one/subjects/workload/payload?rev=analysis%202',
    );
    expect(artifactUrl(alignmentE2eSeriesRef(alignment))).toBe(
      '/api/analyzer/v1/alignments/al_one/subjects/e2e/payload?rev=analysis%202',
    );
    expect(artifactUrl(alignmentBreakdownRef(alignment, 1025))).toBe(
      '/api/analyzer/v1/alignments/al_one/subjects/iteration/iterations/1025?rev=analysis%202',
    );
    expect(artifactUrl(alignmentTimelineIterationRef(alignment, 1025))).toBe(
      '/api/analyzer/v1/alignments/al_one/subjects/timeline/iterations/1025?projection=reference-lane&rev=analysis%202',
    );
    expect(artifactUrl(alignmentSequenceRef(alignment, 'forward pass', 'seq/1'))).toBe(
      '/api/analyzer/v1/alignments/al_one/subjects/iteration/sequences/forward%20pass/seq%2F1?rev=analysis%202',
    );
  });

  it('recognizes every cached timeline artifact for one exact alignment revision', () => {
    const alignment = { ...ALIGNMENT, revision: 'analysis-2' };
    expect(
      isAlignmentTimelineArtifactKey(artifactKey(alignmentTimelineIndexRef(alignment)), alignment),
    ).toBe(true);
    expect(
      isAlignmentTimelineArtifactKey(
        artifactKey(alignmentTimelineIterationRef(alignment, 1025)),
        alignment,
      ),
    ).toBe(true);
    expect(
      isAlignmentTimelineArtifactKey(
        artifactKey(alignmentTimelineIterationRef({ ...alignment, revision: 'other' }, 1025)),
        alignment,
      ),
    ).toBe(false);
    expect(isAlignmentTimelineArtifactKey('not-json', alignment)).toBe(false);
  });

  it('addresses a subject and a worker scope of the same result', () => {
    expect(artifactUrl(kernelTimeShareRef(RUN))).toBe(
      '/api/analyzer/v1/runs/20260715_1_test/subjects/kernel-time-share/payload',
    );
    expect(artifactUrl(workerKernelTimeShareRef(RUN, { poolTag: 'attn', workerId: '0' }))).toBe(
      '/api/analyzer/v1/runs/20260715_1_test/workers/attn/0/subjects/kernel-time-share/payload',
    );
  });

  it('addresses both aggregate run optimality modes', () => {
    expect(artifactUrl(runOptimalityRef(RUN, 'unlocked'))).toBe(
      '/api/analyzer/v1/runs/20260715_1_test/subjects/optimality/payload',
    );
    expect(artifactUrl(runOptimalityRef({ ...RUN, revision: 'analysis 2' }, 'batch_locked'))).toBe(
      '/api/analyzer/v1/runs/20260715_1_test/subjects/optimality/variants/batch_locked/payload?rev=analysis%202',
    );
  });

  it('addresses scoped optimality for runs and predictions through the artifact API', () => {
    expect(artifactUrl(scopedOptimalityRef(RUN, { path: 'attn/0/2' }))).toBe(
      '/api/analyzer/v1/runs/20260715_1_test/subjects/scoped-optimality/report?path=attn%2F0%2F2',
    );
    const prediction = {
      kind: 'prediction' as const,
      id: 'p_one',
      workspace: 'w_main',
      revision: 'analysis 2',
    };
    expect(artifactUrl(scopedOptimalityRef(prediction, { label: 'unified.qk_norm' }))).toBe(
      '/api/analyzer/v1/predictions/p_one/subjects/scoped-optimality/report?label=unified.qk_norm&rev=analysis%202',
    );
  });

  it('addresses exact iteration optimality at the selected worker and revision', () => {
    const run = { ...RUN, revision: 'analysis 2' };
    const worker = { poolTag: 'a/b', workerId: '2' };
    expect(artifactUrl(iterationOptimalityKernelLadderRef(run, worker, '17', 'unlocked'))).toBe(
      '/api/analyzer/v1/runs/20260715_1_test/workers/a%2Fb/2/iterations/17/subjects/optimality-kernel-ladder/payload?mode=unlocked&rev=analysis%202',
    );
    expect(artifactUrl(iterationOptimalityWaterfallRef(run, worker, '17', 'batch_locked'))).toBe(
      '/api/analyzer/v1/runs/20260715_1_test/workers/a%2Fb/2/iterations/17/subjects/optimality-waterfall/payload?mode=batch_locked&rev=analysis%202',
    );
  });

  it('addresses one exact worker operation CostTree and pins its analysis revision', () => {
    const ref = workerCostTreeRef({ ...RUN, revision: 'analysis 2' }, [
      { at: 'pool', role: 'ffn' },
      { at: 'worker', id: '2' },
      { at: 'operation', iter: '17', batch: '3', op: 'ffn/0' },
    ]);
    expect(artifactUrl(ref)).toBe(
      '/api/analyzer/v1/runs/20260715_1_test/workers/ffn/2/operations/17/3/ffn%2F0/subjects/cost-tree/payload?rev=analysis%202',
    );
  });

  it('addresses an exact CostTree leaf throughput analysis at the same revision', () => {
    const ref = kernelThroughputAnalysisRef({ ...RUN, revision: 'analysis 2' }, [
      { at: 'pool', role: 'ffn' },
      { at: 'worker', id: '2' },
      { at: 'operation', iter: '17', batch: '3', op: '1' },
      { at: 'leaf', id: 4 },
    ]);
    expect(artifactUrl(ref)).toBe(
      '/api/analyzer/v1/runs/20260715_1_test/workers/ffn/2/operations/17/3/1/leaves/4/subjects/kernel-throughput-analysis/payload?rev=analysis%202',
    );
    expect(artifactKey(ref)).not.toBe(
      artifactKey(
        kernelThroughputAnalysisRef({ ...RUN, revision: 'analysis 2' }, [
          { at: 'pool', role: 'ffn' },
          { at: 'worker', id: '2' },
          { at: 'operation', iter: '17', batch: '3', op: '1' },
          { at: 'leaf', id: 5 },
        ]),
      ),
    );
  });

  it('keeps a subject report and payload as separate reads', () => {
    expect(artifactUrl(runThroughputRef(RUN))).toBe(
      '/api/analyzer/v1/runs/20260715_1_test/subjects/throughput/report',
    );
    expect(artifactUrl(throughputSeriesRef(RUN))).toBe(
      '/api/analyzer/v1/runs/20260715_1_test/subjects/throughput/payload',
    );
    expect(artifactKey(runThroughputRef(RUN))).not.toBe(artifactKey(throughputSeriesRef(RUN)));
    expect(artifactUrl(batchCompositionRef(RUN))).toBe(
      '/api/analyzer/v1/runs/20260715_1_test/subjects/batch/report',
    );
    expect(artifactUrl(batchSeriesRef(RUN))).toBe(
      '/api/analyzer/v1/runs/20260715_1_test/subjects/batch/payload',
    );
    expect(artifactKey(batchCompositionRef(RUN))).not.toBe(artifactKey(batchSeriesRef(RUN)));
    expect(artifactUrl(requestStateRef(RUN))).toBe(
      '/api/analyzer/v1/runs/20260715_1_test/subjects/request-state/report',
    );
    expect(artifactUrl(requestStateSeriesRef(RUN))).toBe(
      '/api/analyzer/v1/runs/20260715_1_test/subjects/request-state/payload',
    );
    expect(artifactKey(requestStateRef(RUN))).not.toBe(artifactKey(requestStateSeriesRef(RUN)));
    expect(artifactUrl(kvOccupancyRef(RUN))).toBe(
      '/api/analyzer/v1/runs/20260715_1_test/subjects/kv-occupancy/report',
    );
    expect(artifactUrl(kvOccupancySeriesRef(RUN))).toBe(
      '/api/analyzer/v1/runs/20260715_1_test/subjects/kv-occupancy/payload',
    );
    expect(artifactKey(kvOccupancyRef(RUN))).not.toBe(artifactKey(kvOccupancySeriesRef(RUN)));
    expect(artifactUrl(utilizationRef(RUN))).toBe(
      '/api/analyzer/v1/runs/20260715_1_test/subjects/utilization/report',
    );
    expect(artifactUrl(utilizationSeriesRef(RUN))).toBe(
      '/api/analyzer/v1/runs/20260715_1_test/subjects/utilization/payload',
    );
    expect(artifactKey(utilizationRef(RUN))).not.toBe(artifactKey(utilizationSeriesRef(RUN)));
  });

  it('pins a read to an analysis revision when the address names one', () => {
    expect(artifactUrl(kernelTimeShareRef({ ...RUN, revision: 'sha-1234' }))).toBe(
      '/api/analyzer/v1/runs/20260715_1_test/subjects/kernel-time-share/payload?rev=sha-1234',
    );
  });

  it('addresses the configured workload payload and keys it independently', () => {
    expect(artifactUrl(runWorkloadRef(RUN))).toBe(
      '/api/analyzer/v1/runs/20260715_1_test/subjects/workload/payload',
    );
    expect(artifactUrl(runWorkloadRef({ ...RUN, revision: 'trace-2' }))).toBe(
      '/api/analyzer/v1/runs/20260715_1_test/subjects/workload/payload?rev=trace-2',
    );
    expect(artifactKey(runWorkloadRef(RUN))).not.toBe(artifactKey(runThroughputRef(RUN)));
  });

  it('addresses the concurrency timeline and pins its revision', () => {
    expect(artifactUrl(runConcurrencyRef(RUN))).toBe(
      '/api/analyzer/v1/runs/20260715_1_test/subjects/concurrency/payload',
    );
    expect(artifactUrl(runConcurrencyRef({ ...RUN, revision: 'timeline-2' }))).toBe(
      '/api/analyzer/v1/runs/20260715_1_test/subjects/concurrency/payload?rev=timeline-2',
    );
    expect(artifactKey(runConcurrencyRef(RUN))).not.toBe(artifactKey(runThroughputRef(RUN)));
  });

  it('addresses the run capability descriptor and pins its revision', () => {
    const revision = '8f3dfd435d9c2d4f8b7ab38f21ba843667408e37e45e2ca0c584395bcb0c0c75';
    expect(artifactUrl(runDescriptorRef(RUN))).toBe(
      '/api/analyzer/v1/runs/20260715_1_test/descriptor',
    );
    expect(artifactUrl(runDescriptorRef({ ...RUN, revision }))).toBe(
      `/api/analyzer/v1/runs/20260715_1_test/descriptor?rev=${revision}`,
    );
  });

  it('addresses range and seek windows on one canonical worker sequence', () => {
    const sequence = operationsSeqRef(RUN, [
      { at: 'pool', role: 'ffn' },
      { at: 'worker', id: '2' },
      { at: 'operation', iter: '17', batch: '9', op: '3' },
    ]);
    expect(sequence.at).toEqual([
      { at: 'pool', role: 'ffn' },
      { at: 'worker', id: '2' },
    ]);
    expect(sequenceUrl(sequence, { mode: 'range', offset: 64, limit: 64 })).toBe(
      '/api/analyzer/v1/runs/20260715_1_test/workers/ffn/2/subjects/operations/payload?offset=64&limit=64',
    );
    expect(
      sequenceUrl(operationsSeqRef({ ...RUN, revision: 'analysis 2' }, sequence.at), {
        mode: 'seek',
        atMs: 12.5,
      }),
    ).toBe(
      '/api/analyzer/v1/runs/20260715_1_test/workers/ffn/2/subjects/operations/seek?at_ms=12.5&rev=analysis%202',
    );
    expect(sequenceReadKey(sequence, { mode: 'range', offset: 0, limit: 64 })).not.toBe(
      sequenceReadKey(sequence, { mode: 'range', offset: 64, limit: 64 }),
    );
    expect(sequenceKey(sequence)).toBe(sequenceKey(operationsSeqRef(RUN, sequence.at)));
  });

  it('addresses run and prediction kernel-input distributions with revisions', () => {
    expect(artifactUrl(kernelInputDistributionRef(RUN))).toBe(
      '/api/analyzer/v1/runs/20260715_1_test/subjects/kernel-input-distribution/payload',
    );
    const prediction: ResultRef = {
      kind: 'prediction',
      id: 'pred/a',
      workspace: 'w_main',
      revision: 'analysis 2',
    };
    expect(artifactUrl(kernelInputDistributionRef(prediction))).toBe(
      '/api/analyzer/v1/predictions/pred%2Fa/subjects/kernel-input-distribution/payload?rev=analysis%202',
    );
    expect(artifactKey(kernelInputDistributionRef(RUN))).not.toBe(
      artifactKey(kernelInputDistributionRef(prediction)),
    );
  });

  it('escapes every server-issued token it puts in a path', () => {
    // Ids and pool tags are opaque. One containing a slash must address one
    // segment, not silently become two and read something else.
    expect(
      artifactUrl(
        workerKernelTimeShareRef({ ...RUN, id: 'a/b' }, { poolTag: 'p/q', workerId: '0' }),
      ),
    ).toBe('/api/analyzer/v1/runs/a%2Fb/workers/p%2Fq/0/subjects/kernel-time-share/payload');
  });

  it('does not vary with workspace, because the catalog routes do not', () => {
    // Rows carry their own `workspace_id` and the panel filters on it. If this
    // ever becomes a query parameter, this test is where that change surfaces.
    expect(artifactUrl(catalogRef('w_main', 'run'))).toBe(
      artifactUrl(catalogRef('w_other', 'run')),
    );
  });
});

describe('artifactKey', () => {
  it('separates workspaces and kinds that share a URL', () => {
    expect(artifactKey(catalogRef('w_main', 'run'))).not.toBe(
      artifactKey(catalogRef('w_other', 'run')),
    );
    expect(artifactKey(catalogRef('w_main', 'run'))).not.toBe(
      artifactKey(catalogRef('w_main', 'sweep')),
    );
  });

  it('is equal for equal refs regardless of how they were built', () => {
    const built = { kind: 'catalog', of: 'run', workspace: 'w_main' } as const;
    expect(artifactKey(built)).toBe(artifactKey(catalogRef('w_main', 'run')));
  });

  it('separates two analyses of the same result', () => {
    // Without this a re-analysis would be served from the previous analysis's
    // cache under the same run id.
    expect(artifactKey(kernelTimeShareRef({ ...RUN, revision: 'a' }))).not.toBe(
      artifactKey(kernelTimeShareRef({ ...RUN, revision: 'b' })),
    );
    expect(artifactKey(kernelTimeShareRef(RUN))).not.toBe(
      artifactKey(kernelTimeShareRef({ ...RUN, revision: 'a' })),
    );
  });

  it('separates two workers that share a numeric id in different pools', () => {
    expect(artifactKey(workerKernelTimeShareRef(RUN, { poolTag: 'attn', workerId: '0' }))).not.toBe(
      artifactKey(workerKernelTimeShareRef(RUN, { poolTag: 'ffn', workerId: '0' })),
    );
  });

  it('separates an unpinned read from one pinned to a revision named "latest"', () => {
    // Absent means "whatever the newest analysis is" and follows a
    // re-analysis; the word is a revision like any other and does not. Spelling
    // absence as the word made the two share a cache entry.
    expect(artifactKey(kernelTimeShareRef(RUN))).not.toBe(
      artifactKey(kernelTimeShareRef({ ...RUN, revision: 'latest' })),
    );
  });

  it('separates coordinates that differ only in where a separator falls', () => {
    // Result ids, revisions and worker tokens are opaque and may contain the
    // separator. Joined into one string, these two name the same entry — and
    // the reader is shown another result's numbers under their own address.
    expect(artifactKey(kernelTimeShareRef({ ...RUN, id: 'a/b', revision: 'c' }))).not.toBe(
      artifactKey(kernelTimeShareRef({ ...RUN, id: 'a', revision: 'b/c' })),
    );
    expect(
      artifactKey(workerKernelTimeShareRef(RUN, { poolTag: 'attn/0', workerId: '1' })),
    ).not.toBe(artifactKey(workerKernelTimeShareRef(RUN, { poolTag: 'attn', workerId: '0/1' })));
  });

  it('separates a whole result from one of its workers', () => {
    // They shared a prefix, so the two reads were one entry apart only by
    // arity — and a worker token carrying a separator closed that gap.
    expect(artifactKey(kernelTimeShareRef(RUN))).not.toBe(
      artifactKey(workerKernelTimeShareRef(RUN, { poolTag: 'attn', workerId: '0' })),
    );
  });
});

describe('sweep aggregate artifact', () => {
  it('uses the analyzer-v1 subject route and keeps revisions in URL and key', () => {
    expect(artifactUrl(sweepAnalysisRef({ ...SWEEP, revision: 'r 2' }))).toBe(
      '/api/analyzer/v1/sweeps/s_test/subjects/sweep/payload?rev=r%202',
    );
    expect(artifactKey(sweepAnalysisRef(SWEEP))).not.toBe(
      artifactKey(sweepAnalysisRef({ ...SWEEP, revision: 'r 2' })),
    );
  });
});
