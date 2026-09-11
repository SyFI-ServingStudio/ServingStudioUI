import { afterEach, describe, expect, it, vi } from 'vitest';

import kvSeriesJson from '../../testdata/analyzer-v1/afd-qwen3-duration-reached/payloads/kv_occupancy_series.json';
import batchSeriesJson from '../../testdata/analyzer-v1/afd-qwen3-duration-reached/payloads/batch_scatter.json';
import utilizationJson from '../../testdata/analyzer-v1/afd-qwen3-duration-reached/payloads/utilization_series.json';
import throughputSeriesJson from '../../testdata/analyzer-v1/afd-qwen3-duration-reached/payloads/throughput_segments.json';
import sloGeneralJson from '../../testdata/analyzer-v1/afd-qwen3-duration-reached/payloads/slo_general_cdf.json';
import runDescriptorJson from '../../testdata/analyzer-v1/afd-qwen3-duration-reached/run_descriptor.json';
import kernelInputDistributionJson from '../../testdata/analyzer-v1/glm52-mtp-shape-refined/payloads/kernel_input_distribution_scatter.json';
import alignmentIterationSeriesJson from '../../e2e/fixtures/alignment/payloads/alignment_iteration_series.json';

import { fetchArtifact } from './client';
import {
  alignmentDescriptorRef,
  alignmentIterationSeriesRef,
  catalogRef,
  batchSeriesRef,
  kernelInputDistributionRef,
  kernelThroughputAnalysisRef,
  kvOccupancySeriesRef,
  requestStateSeriesRef,
  sweepAnalysisRef,
  runLatencyRef,
  runConcurrencyRef,
  runDescriptorRef,
  runWorkloadRef,
  throughputSeriesRef,
  utilizationSeriesRef,
  workerCostTreeRef,
} from './ref';
import type { ResultRef } from '../location';
import type { RunLatency } from './ref';

const REF = catalogRef('w_main', 'run');
const RUN = { kind: 'run', id: 'run-1', workspace: 'w_main' } satisfies ResultRef;
const SWEEP = { kind: 'sweep', id: 's-one', workspace: 'w_main' } satisfies ResultRef;
const ALIGNMENT = {
  kind: 'alignment',
  id: 'al_one',
  workspace: 'w_main',
} satisfies ResultRef;

function respond(body: unknown, init?: ResponseInit & { headers?: Record<string, string> }) {
  return vi.fn().mockResolvedValue(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json', ...init?.headers },
      ...init,
    }),
  );
}

function stubFetch(implementation: typeof fetch | ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', implementation);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it('maps sweep schema failures to structured incompatible results', async () => {
  stubFetch(respond({ schema_version: 7 }));
  const result = await fetchArtifact(sweepAnalysisRef(SWEEP));
  expect(result).toMatchObject({ status: 'incompatible', received: 7 });
  expect(result.status === 'incompatible' && result.issues?.join('\n')).toContain('schema_version');
});

it('maps alignment schema and identity failures to structured incompatible results', async () => {
  stubFetch(respond({ schema_version: 7 }));
  const schema = await fetchArtifact(alignmentDescriptorRef(ALIGNMENT));
  expect(schema).toMatchObject({ status: 'incompatible', received: 7 });
  expect(schema.status === 'incompatible' && schema.issues?.join('\n')).toContain('schema_version');

  stubFetch(
    respond({
      schema_version: 1,
      alignment_id: 'al_other',
      kind: 'alignment',
      display_name: 'Other',
      lifecycle: { kernel_analysis: 'complete', e2e_analysis: 'complete' },
      prediction: null,
      subjects: {
        iteration: { status: 'not_generated', views: [], has_iteration_detail: false },
        timeline: { status: 'not_generated', views: [], has_iteration_detail: false },
        workload: { status: 'not_generated', views: [], has_iteration_detail: false },
        e2e: { status: 'not_generated', views: [], has_iteration_detail: false },
      },
    }),
  );
  const identity = await fetchArtifact(alignmentDescriptorRef(ALIGNMENT));
  expect(identity).toMatchObject({ status: 'incompatible', received: 1 });
  expect(identity.status === 'incompatible' && identity.issues?.join('\n')).toContain('identity');
});

it('preserves the accepted alignment wire schema version in artifact metadata', async () => {
  stubFetch(respond({ ...alignmentIterationSeriesJson, schema_version: 2 }));
  await expect(fetchArtifact(alignmentIterationSeriesRef(ALIGNMENT))).resolves.toMatchObject({
    status: 'ready',
    schemaVersion: 2,
  });
});

const READY_BODY = {
  protocol_version: 1,
  generated_at: '2026-09-01T00:00:00Z',
  runs: [],
};

const REQUEST_STATE_TIMELINE = {
  schema_version: 1,
  meta: { log_dir: 'logs/request-state' },
  t_start_ms: [0, 5],
  t_end_ms: [5, 10],
  cluster_series: [{ category: 'pending', values: [1, 2] }],
  pools: [],
};

const CONCURRENCY = {
  schema_version: 1,
  meta: {
    log_dir: 'logs/test-run',
    request_count: 7,
    span_ms: 1_000,
    bins: 2,
    max_points: 512,
    aggregation: 'equal-width time-weighted mean',
  },
  t_ms: [500, 1_000],
  active: [1.25, 2.5],
  peak: 4,
  definitions: { scope: 'run', active: 'active', t_ms: 'time', peak: 'peak', binning: 'bins' },
};

const COST_TREE_REF = workerCostTreeRef(RUN, [
  { at: 'pool', role: 'ffn' },
  { at: 'worker', id: '2' },
  { at: 'operation', iter: '17', batch: '3', op: 'ffn_0' },
]);

const COST_TREE = {
  schema_version: 1,
  identity: {
    pool_tag: 'ffn',
    worker_id: 2,
    iter_id: 17,
    batch_id: 3,
    operation_id: 'ffn_0',
    section: 'ffn',
    layer: 4,
  },
  interval: { start_ms: 12, end_ms: 13.5 },
  inputs: [],
  tree: {
    kind: 'leaf',
    slot: { name: 'ffn.gemm', kind: 'single_gemm', kernel_config: {}, backend: null },
    base: 1.5,
    stats: { input: {}, flops: null, bytes: null, tflops: null, gbps: null },
  },
};

const KERNEL_ANALYSIS_REF = kernelThroughputAnalysisRef({ ...RUN, revision: 'analysis-v2' }, [
  { at: 'pool', role: 'ffn' },
  { at: 'worker', id: '2' },
  { at: 'operation', iter: '17', batch: '3', op: '1' },
  { at: 'leaf', id: 4 },
]);
const KERNEL_ANALYSIS = {
  schema_version: 1,
  identity: {
    pool_tag: 'ffn',
    worker_id: 2,
    iter_id: 17,
    batch_id: 3,
    operation_id: 1,
    section: 'ffn',
    layer: 4,
  },
  leaf_id: 4,
  slot: {
    name: 'ffn.gemm',
    kind: 'single_gemm',
    kernel_config: { dtype: 'bf16' },
    backend: 'torch',
  },
  exact_input: { m: 2 },
  describe_config: { dtype: 'bf16' },
  input_fields: ['m'],
  grid_axes: [[1, 2]],
  points: [
    { input: { m: 1 }, time_ms: 1, flops: 8, bytes: 4, energy_j: 0, coverage: 1 },
    { input: { m: 2 }, time_ms: 2, flops: 16, bytes: 8, energy_j: 0, coverage: 2 },
  ],
  semantics: 'cache_eval_at_declared_grid',
};

describe('fetchArtifact', () => {
  it('reads exact kernel throughput analysis and maps identity failures to incompatible', async () => {
    stubFetch(respond(KERNEL_ANALYSIS, { headers: { etag: '"kernel-grid"' } }));
    expect(await fetchArtifact(KERNEL_ANALYSIS_REF)).toMatchObject({
      status: 'ready',
      schemaVersion: 1,
      revision: 'kernel-grid',
      value: {
        worker: { poolTag: 'ffn', workerId: '2' },
        operation: { iterId: '17', batchId: '3', operationId: '1' },
        leafId: 4,
        points: expect.arrayContaining([expect.objectContaining({ input: { m: 1 }, timeMs: 1 })]),
      },
    });

    stubFetch(respond({ ...KERNEL_ANALYSIS, leaf_id: 5 }));
    const substituted = await fetchArtifact(KERNEL_ANALYSIS_REF);
    expect(substituted).toMatchObject({ status: 'incompatible', received: 1 });
    expect(substituted.status === 'incompatible' && substituted.issues?.join('\n')).toContain(
      'identity',
    );
  });

  it('reads an exact worker CostTree and maps recursive schema failures to incompatible', async () => {
    stubFetch(respond(COST_TREE, { headers: { etag: '"tree-body"' } }));
    expect(await fetchArtifact(COST_TREE_REF)).toMatchObject({
      status: 'ready',
      schemaVersion: 1,
      revision: 'tree-body',
      value: {
        worker: { poolTag: 'ffn', workerId: '2' },
        operation: { iterId: '17', batchId: '3', operationId: 'ffn_0' },
      },
    });

    stubFetch(respond({ ...COST_TREE, tree: { ...COST_TREE.tree, base: -1 } }));
    const malformed = await fetchArtifact(COST_TREE_REF);
    expect(malformed).toMatchObject({ status: 'incompatible', received: 1 });
    expect(malformed.status === 'incompatible' && malformed.issues?.join('\n')).toContain(
      'Invalid CostTree',
    );

    const overflow = {
      ...COST_TREE,
      tree: {
        kind: 'sum',
        children: [
          { ...COST_TREE.tree, base: Number.MAX_VALUE },
          { ...COST_TREE.tree, base: Number.MAX_VALUE },
        ],
      },
    };
    stubFetch(respond(overflow));
    const derivedOverflow = await fetchArtifact(COST_TREE_REF);
    expect(derivedOverflow).toMatchObject({ status: 'incompatible', received: 1 });
    expect(
      derivedOverflow.status === 'incompatible' && derivedOverflow.issues?.join('\n'),
    ).toContain('derived numeric value overflowed');
  });

  it('returns ready with the revision the response identifies itself by', async () => {
    stubFetch(respond(READY_BODY, { headers: { etag: '"rev-7"' } }));
    const result = await fetchArtifact(REF);
    expect(result).toEqual({
      status: 'ready',
      value: [],
      schemaVersion: 1,
      revision: 'rev-7',
    });
  });

  it('falls back to generated_at when the Analyzer sends no ETag', async () => {
    stubFetch(respond(READY_BODY));
    const result = await fetchArtifact(REF);
    expect(result).toMatchObject({ status: 'ready', revision: '2026-09-01T00:00:00Z' });
  });

  it('calls a missing route unavailable, not failed', async () => {
    // 404 here means this deployment's Analyzer predates the kind. Reporting it
    // as an error would send the user looking for a fault that is not theirs.
    stubFetch(respond('', { status: 404, statusText: 'Not Found' }));
    expect(await fetchArtifact(REF)).toMatchObject({ status: 'unavailable', code: '404' });
  });

  it('decodes the configured workload and preserves incompatibility issues', async () => {
    const workload = {
      schema_version: 1,
      scope: 'configured_trace',
      source_paths: ['trace/requests.csv'],
      request_count: 1,
      average_input_tokens: 12,
      average_output_tokens: 24,
      arrival_basis: 'effective_open_loop',
      request_rate: 2,
      token_lengths: [16],
      input_density: [1],
      output_density: [1],
      arrival_seconds: [0],
      arrivals: [1],
      arrival_trend: [1],
      peak_to_mean: 1,
    };
    stubFetch(respond(workload, { headers: { etag: '"workload-rev"' } }));
    expect(await fetchArtifact(runWorkloadRef(RUN))).toMatchObject({
      status: 'ready',
      schemaVersion: 1,
      revision: 'workload-rev',
      value: { averageInputTokens: 12, tokenLengths: [16] },
    });

    stubFetch(respond({ ...workload, arrivals: [] }));
    const incompatible = await fetchArtifact(runWorkloadRef(RUN));
    expect(incompatible).toMatchObject({ status: 'incompatible', received: 1 });
    expect(incompatible.status === 'incompatible' && incompatible.issues?.[0]).toContain(
      'arrival_seconds',
    );
  });

  it('returns complete latency CDFs and preserves semantic issues', async () => {
    stubFetch(respond(sloGeneralJson, { headers: { etag: '"slo-rev"' } }));
    const ready = await fetchArtifact(runLatencyRef(RUN));
    expect(ready).toMatchObject({
      status: 'ready',
      schemaVersion: 1,
      revision: 'slo-rev',
    });
    const latency = ready.status === 'ready' ? (ready.value as RunLatency) : null;
    expect(latency?.series[0]).toMatchObject({
      key: 'ttft',
      x: expect.any(Array),
      yPct: expect.any(Array),
    });

    const body = structuredClone(sloGeneralJson);
    body.series[0].y_pct = [...body.series[0].y_pct].reverse();
    stubFetch(respond(body));
    const incompatible = await fetchArtifact(runLatencyRef(RUN));
    expect(incompatible).toMatchObject({ status: 'incompatible', received: 1 });
    expect(incompatible.status === 'incompatible' && incompatible.issues).toContain(
      'ttft CDF is not non-decreasing',
    );

    const malformed = structuredClone(sloGeneralJson);
    Reflect.deleteProperty(malformed.series[0], 'y_pct');
    stubFetch(respond(malformed));
    const structural = await fetchArtifact(runLatencyRef(RUN));
    expect(structural).toMatchObject({ status: 'incompatible', received: 1 });
    expect(structural.status === 'incompatible' && structural.issues?.join('\n')).toContain(
      'series.0.y_pct',
    );
  });

  it('decodes the run capability descriptor and preserves protocol issues', async () => {
    const matchingDescriptor = {
      ...runDescriptorJson,
      workspace_id: RUN.workspace,
      run_id: RUN.id,
    };
    stubFetch(respond(matchingDescriptor, { headers: { etag: 'W/"descriptor-rev"' } }));
    expect(await fetchArtifact(runDescriptorRef(RUN))).toMatchObject({
      status: 'ready',
      schemaVersion: 1,
      revision: 'descriptor-rev',
      value: {
        runId: 'run-1',
        details: { 'worker-cost-tree': { status: 'not_generated' } },
      },
    });

    stubFetch(respond({ ...matchingDescriptor, protocol_version: 9 }));
    const incompatible = await fetchArtifact(runDescriptorRef(RUN));
    expect(incompatible).toMatchObject({ status: 'incompatible', received: 9 });
    expect(incompatible.status === 'incompatible' && incompatible.issues?.[0]).toContain(
      'protocol_version',
    );
  });

  it('uses the response revision when a requested descriptor pin is stale', async () => {
    const matchingDescriptor = {
      ...runDescriptorJson,
      workspace_id: RUN.workspace,
      run_id: RUN.id,
    };
    stubFetch(respond(matchingDescriptor, { headers: { etag: 'W/"current-revision"' } }));

    const matching = await fetchArtifact(
      runDescriptorRef({ ...RUN, revision: 'current-revision' }),
    );
    expect(matching).toMatchObject({ status: 'ready', revision: 'current-revision' });

    stubFetch(respond(matchingDescriptor, { headers: { etag: 'W/"current-revision"' } }));
    const stale = await fetchArtifact(runDescriptorRef({ ...RUN, revision: 'old-revision' }));
    expect(stale).toMatchObject({ status: 'ready', revision: 'current-revision' });
  });

  it('falls back to the descriptor analysis revision without an ETag', async () => {
    const matchingDescriptor = {
      ...runDescriptorJson,
      workspace_id: RUN.workspace,
      run_id: RUN.id,
    };
    stubFetch(respond(matchingDescriptor));

    expect(await fetchArtifact(runDescriptorRef(RUN))).toMatchObject({
      status: 'ready',
      revision: runDescriptorJson.analysis.revision,
    });
  });

  it('rejects a descriptor substituted under another result address', async () => {
    stubFetch(respond(runDescriptorJson));
    const incompatible = await fetchArtifact(runDescriptorRef(RUN));

    expect(incompatible).toMatchObject({ status: 'incompatible' });
    expect(incompatible.status === 'incompatible' && incompatible.issues).toEqual([
      'run_id: expected "run-1", received "fixture-afd-qwen3-v1"',
    ]);
  });

  it('returns the complete concurrency timeline and maps unavailable separately', async () => {
    stubFetch(respond(CONCURRENCY, { headers: { etag: '"concurrency-rev"' } }));
    expect(await fetchArtifact(runConcurrencyRef(RUN))).toMatchObject({
      status: 'ready',
      schemaVersion: 1,
      revision: 'concurrency-rev',
      value: { tMs: [500, 1_000], active: [1.25, 2.5], sourceLogDir: 'logs/test-run' },
    });

    stubFetch(
      respond({
        schema_version: 1,
        meta: { log_dir: 'logs/test-run', available: false, reason: 'no stage history' },
        t_ms: [],
        active: [],
        peak: 0,
        definitions: CONCURRENCY.definitions,
      }),
    );
    expect(await fetchArtifact(runConcurrencyRef(RUN))).toMatchObject({
      status: 'unavailable',
      reason: 'no stage history',
    });

    stubFetch(respond({ ...CONCURRENCY, active: [5, 2.5] }));
    const incompatible = await fetchArtifact(runConcurrencyRef(RUN));
    expect(incompatible).toMatchObject({ status: 'incompatible', received: 1 });
    expect(incompatible.status === 'incompatible' && incompatible.issues?.[0]).toContain(
      'cannot exceed exact peak',
    );
  });

  it('decodes kernel-input distributions and preserves producer unavailability', async () => {
    stubFetch(respond(kernelInputDistributionJson, { headers: { etag: '"input-rev"' } }));
    expect(await fetchArtifact(kernelInputDistributionRef(RUN))).toMatchObject({
      status: 'ready',
      schemaVersion: 1,
      revision: 'input-rev',
      value: {
        positions: expect.arrayContaining([
          expect.objectContaining({ projection: 'categorical' }),
          expect.objectContaining({ projection: 'feature_1d' }),
          expect.objectContaining({ projection: 'raw_2d' }),
          expect.objectContaining({ projection: 'pca' }),
        ]),
        positionCounts: { plotted: 319, manifest: 377, omitted: 58 },
      },
    });

    stubFetch(
      respond({
        schema_version: 1,
        meta: { log_dir: 'logs/old', available: false, reason: 'slot_backend is absent' },
        positions: [],
      }),
    );
    expect(await fetchArtifact(kernelInputDistributionRef(RUN))).toEqual({
      status: 'unavailable',
      reason: 'slot_backend is absent',
    });

    stubFetch(respond({ ...kernelInputDistributionJson, extra: true }));
    const incompatible = await fetchArtifact(kernelInputDistributionRef(RUN));
    expect(incompatible).toMatchObject({ status: 'incompatible', received: 1 });
    expect(incompatible.status === 'incompatible' && incompatible.issues?.join('\n')).toContain(
      '<root>',
    );
  });

  it('calls 410 not_generated, because re-running the analysis would fix it', async () => {
    stubFetch(respond('', { status: 410, statusText: 'Gone' }));
    expect(await fetchArtifact(REF)).toMatchObject({ status: 'not_generated' });
  });

  it('calls a server error failed', async () => {
    stubFetch(respond('', { status: 500, statusText: 'Internal Server Error' }));
    expect(await fetchArtifact(REF)).toMatchObject({ status: 'failed', code: '500' });
  });

  it('reports a transport failure without throwing', async () => {
    stubFetch(vi.fn().mockRejectedValue(new Error('connection refused')));
    expect(await fetchArtifact(REF)).toEqual({
      status: 'failed',
      code: 'network',
      reason: 'connection refused',
    });
  });

  it('reports a body that is not JSON', async () => {
    stubFetch(respond('<!doctype html>'));
    expect(await fetchArtifact(REF)).toMatchObject({ status: 'failed', code: 'invalid_json' });
  });

  it('names the field a schema mismatch is about', async () => {
    stubFetch(respond({ protocol_version: 1, runs: [{ workspace_id: 'w_main' }] }));
    const result = await fetchArtifact(REF);
    expect(result).toMatchObject({ status: 'failed', code: 'invalid_body' });
    expect(result.status === 'failed' && result.reason).toContain('runs.0.run_id');
  });

  it('separates a newer protocol from a broken body', async () => {
    stubFetch(respond({ ...READY_BODY, protocol_version: 9 }));
    expect(await fetchArtifact(REF)).toMatchObject({ status: 'incompatible', received: 9 });
  });

  it('returns a complete KV payload with the response revision', async () => {
    stubFetch(respond(kvSeriesJson, { headers: { etag: '"kv-rev"' } }));
    const result = await fetchArtifact(kvOccupancySeriesRef(RUN));

    expect(result).toMatchObject({
      status: 'ready',
      schemaVersion: 1,
      revision: 'kv-rev',
      value: { sourceLogDir: kvSeriesJson.meta.log_dir },
    });
  });

  it('keeps KV incompatibility issues structured', async () => {
    stubFetch(respond({ ...kvSeriesJson, schema_version: 9 }));
    const result = await fetchArtifact(kvOccupancySeriesRef(RUN));

    expect(result).toMatchObject({ status: 'incompatible', received: 9 });
    expect(result.status === 'incompatible' && result.issues?.[0]).toContain('schema_version');
  });

  it('maps an unavailable KV payload to the shared unavailable state', async () => {
    stubFetch(
      respond({
        schema_version: 1,
        meta: { log_dir: 'logs/x', available: false, reason: 'no KV pool' },
        t_start_ms: [],
        t_end_ms: [],
        series: [],
      }),
    );

    expect(await fetchArtifact(kvOccupancySeriesRef(RUN))).toMatchObject({
      status: 'unavailable',
      reason: 'no KV pool',
    });
  });

  it('returns a complete utilization payload with structured incompatibility issues', async () => {
    stubFetch(respond(utilizationJson, { headers: { etag: '"util-rev"' } }));
    expect(await fetchArtifact(utilizationSeriesRef(RUN))).toMatchObject({
      status: 'ready',
      schemaVersion: 1,
      revision: 'util-rev',
      value: { sourceLogDir: utilizationJson.meta.log_dir },
    });

    stubFetch(respond({ ...utilizationJson, schema_version: 9 }));
    const incompatible = await fetchArtifact(utilizationSeriesRef(RUN));
    expect(incompatible).toMatchObject({ status: 'incompatible', received: 9 });
    expect(incompatible.status === 'incompatible' && incompatible.issues?.[0]).toContain(
      'schema_version',
    );
  });

  it('keeps semantic utilization incompatibility issues structured', async () => {
    const body = structuredClone(utilizationJson);
    const poolKey = body.series[0].key as keyof typeof body.meta.avg;
    body.meta.avg[poolKey] += 0.1;
    stubFetch(respond(body));

    const incompatible = await fetchArtifact(utilizationSeriesRef(RUN));
    expect(incompatible).toMatchObject({ status: 'incompatible', received: 1 });
    expect(incompatible.status === 'incompatible' && incompatible.issues).toContain(
      `meta.avg.${poolKey}: does not match the series mean`,
    );
  });

  it('maps an unavailable utilization payload to the shared unavailable state', async () => {
    stubFetch(
      respond({
        schema_version: 1,
        meta: { log_dir: 'logs/x', available: false, reason: 'no positive iteration durations' },
        t_start_ms: [],
        t_end_ms: [],
        series: [],
        worker_series: [],
      }),
    );

    expect(await fetchArtifact(utilizationSeriesRef(RUN))).toMatchObject({
      status: 'unavailable',
      reason: 'no positive iteration durations',
    });
  });

  it('returns complete request-state timelines and structured incompatibility issues', async () => {
    stubFetch(respond(REQUEST_STATE_TIMELINE, { headers: { etag: '"queue-rev"' } }));
    expect(await fetchArtifact(requestStateSeriesRef(RUN))).toMatchObject({
      status: 'ready',
      schemaVersion: 1,
      revision: 'queue-rev',
      value: { sourceLogDir: 'logs/request-state' },
    });

    stubFetch(respond({ ...REQUEST_STATE_TIMELINE, t_start_ms: [0, 6] }));
    const incompatible = await fetchArtifact(requestStateSeriesRef(RUN));
    expect(incompatible).toMatchObject({ status: 'incompatible', received: 1 });
    expect(incompatible.status === 'incompatible' && incompatible.issues).toContain(
      't_start_ms.1: must equal the previous bin end',
    );
  });

  it('maps an unavailable request-state timeline to the shared unavailable state', async () => {
    stubFetch(
      respond({
        schema_version: 1,
        meta: { log_dir: 'logs/x', available: false, reason: 'no stage history' },
        t_start_ms: [],
        t_end_ms: [],
        cluster_series: [],
        pools: [],
      }),
    );
    expect(await fetchArtifact(requestStateSeriesRef(RUN))).toMatchObject({
      status: 'unavailable',
      reason: 'no stage history',
    });
  });

  it('returns the complete batch scatter and preserves semantic issues', async () => {
    stubFetch(respond(batchSeriesJson, { headers: { etag: '"batch-rev"' } }));
    expect(await fetchArtifact(batchSeriesRef(RUN))).toMatchObject({
      status: 'ready',
      schemaVersion: 1,
      revision: 'batch-rev',
      value: { sourceLogDir: batchSeriesJson.meta.log_dir },
    });

    const body = structuredClone(batchSeriesJson);
    body.pools[0].series[0].values.pop();
    stubFetch(respond(body));
    const incompatible = await fetchArtifact(batchSeriesRef(RUN));
    expect(incompatible).toMatchObject({ status: 'incompatible', received: 1 });
    expect(incompatible.status === 'incompatible' && incompatible.issues?.join('\n')).toContain(
      'values: has',
    );
  });

  it('maps an unavailable batch scatter to the shared unavailable state', async () => {
    stubFetch(
      respond({
        schema_version: 1,
        meta: { log_dir: 'logs/x', available: false, reason: 'no invocations' },
        pools: [],
        workers: [],
      }),
    );
    expect(await fetchArtifact(batchSeriesRef(RUN))).toMatchObject({
      status: 'unavailable',
      reason: 'no invocations',
    });
  });

  it('returns complete throughput timelines and preserves semantic issues', async () => {
    stubFetch(respond(throughputSeriesJson, { headers: { etag: '"throughput-rev"' } }));
    expect(await fetchArtifact(throughputSeriesRef(RUN))).toMatchObject({
      status: 'ready',
      schemaVersion: 1,
      revision: 'throughput-rev',
      value: { sourceLogDir: throughputSeriesJson.meta.log_dir },
    });

    const body = structuredClone(throughputSeriesJson);
    body.series[0].per_gpu[0] += 1;
    stubFetch(respond(body));
    const incompatible = await fetchArtifact(throughputSeriesRef(RUN));
    expect(incompatible).toMatchObject({ status: 'incompatible', received: 1 });
    expect(incompatible.status === 'incompatible' && incompatible.issues?.join('\n')).toContain(
      'must equal prefill + decode',
    );
  });

  it('maps an unavailable throughput timeline to the shared unavailable state', async () => {
    stubFetch(
      respond({
        schema_version: 1,
        meta: { log_dir: 'logs/x', available: false, reason: 'fewer than 2 ticks' },
        t_start_ms: [],
        t_end_ms: [],
        series: [],
      }),
    );
    expect(await fetchArtifact(throughputSeriesRef(RUN))).toMatchObject({
      status: 'unavailable',
      reason: 'fewer than 2 ticks',
    });
  });

  it('maps a producer ready-empty throughput timeline to the shared unavailable state', async () => {
    const emptySeries = [
      { key: 'total', label: 'Total', per_gpu: [] },
      { key: 'prefill', label: 'Prefill', per_gpu: [] },
      { key: 'decode', label: 'Decode', per_gpu: [] },
    ];
    stubFetch(
      respond({
        schema_version: 1,
        meta: {
          log_dir: 'logs/x',
          num_gpus: 1,
          gpu_name: '',
          unit: 'tokens/s per GPU',
          avg_per_gpu: { total: 0, prefill: 0, decode: 0 },
        },
        t_start_ms: [],
        t_end_ms: [],
        series: emptySeries,
        coarse: { t_start_ms: [], t_end_ms: [], series: emptySeries },
        definitions: {},
      }),
    );

    expect(await fetchArtifact(throughputSeriesRef(RUN))).toMatchObject({
      status: 'unavailable',
      reason: 'no positive-width throughput intervals',
    });
  });

  it('rethrows an abort instead of reporting it as a failure', async () => {
    const controller = new AbortController();
    controller.abort();
    stubFetch(vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')));
    await expect(fetchArtifact(REF, controller.signal)).rejects.toThrow();
  });
});
