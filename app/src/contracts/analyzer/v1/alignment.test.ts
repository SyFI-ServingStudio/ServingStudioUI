import { describe, expect, it } from 'vitest';

import {
  parseAnalyzerV1AlignmentBreakdown,
  parseAnalyzerV1AlignmentDescriptor,
  parseAnalyzerV1AlignmentE2eSeries,
  parseAnalyzerV1AlignmentIterationSeries,
  parseAnalyzerV1AlignmentSequence,
  parseAnalyzerV1AlignmentTimelineIndex,
  parseAnalyzerV1AlignmentTimelineIteration,
  parseAnalyzerV1AlignmentWorkloadSeries,
} from './alignment';

const ALIGNMENT_ID = 'al_16b044e79e03cc75';

function descriptorWire(overrides: Record<string, unknown> = {}) {
  const subject = (ready: boolean, sharded: boolean) => ({
    status: ready ? 'ready' : 'not_generated',
    report_href: ready ? 'alignments/x/subjects/y/report' : null,
    payload_href: ready ? 'alignments/x/subjects/y/payload' : null,
    iteration_href: ready && sharded ? 'alignments/x/subjects/y/iterations/{iteration_id}' : null,
  });
  return {
    schema_version: 1,
    alignment_id: ALIGNMENT_ID,
    kind: 'alignment',
    display_name: 'tp4/rate32',
    lifecycle: { kernel_analysis: 'complete', e2e_analysis: 'not_started' },
    prediction: {
      prediction_id: 'p_45cdb1ba',
      display_name: 'tp4/rate32/timing_predict',
    },
    subjects: {
      iteration: subject(true, true),
      timeline: subject(true, true),
      workload: subject(false, false),
      e2e: subject(false, false),
    },
    ...overrides,
  };
}

describe('alignment descriptor', () => {
  it('reports each analysis half separately, because either may be missing', () => {
    const descriptor = parseAnalyzerV1AlignmentDescriptor(descriptorWire(), ALIGNMENT_ID);
    expect(descriptor.lifecycle).toEqual({
      kernelAnalysis: 'complete',
      e2eAnalysis: 'not_started',
    });
  });

  it('records which subjects serve per-iteration detail', () => {
    const descriptor = parseAnalyzerV1AlignmentDescriptor(descriptorWire(), ALIGNMENT_ID);
    expect(descriptor.subjects.timeline).toEqual({ status: 'ready', hasIterationDetail: true });
    expect(descriptor.subjects.e2e).toEqual({ status: 'not_generated', hasIterationDetail: false });
  });

  it('rejects a descriptor for a different bundle than the one requested', () => {
    expect(() => parseAnalyzerV1AlignmentDescriptor(descriptorWire(), 'al_other')).toThrow(
      /identity/,
    );
  });

  it('rejects a descriptor missing one of the four subjects', () => {
    const wire = descriptorWire();
    delete (wire.subjects as Record<string, unknown>).workload;
    expect(() => parseAnalyzerV1AlignmentDescriptor(wire, ALIGNMENT_ID)).toThrow(/workload/);
  });

  it('carries the prediction the bundle was paired against', () => {
    const descriptor = parseAnalyzerV1AlignmentDescriptor(descriptorWire(), ALIGNMENT_ID);
    expect(descriptor.prediction).toEqual({
      predictionId: 'p_45cdb1ba',
      displayName: 'tp4/rate32/timing_predict',
    });
  });

  it('accepts a bundle that names no servable prediction', () => {
    const descriptor = parseAnalyzerV1AlignmentDescriptor(
      descriptorWire({ prediction: null }),
      ALIGNMENT_ID,
    );
    expect(descriptor.prediction).toBeNull();
  });

  it('rejects a descriptor that omits the prediction key entirely', () => {
    const wire = descriptorWire();
    delete (wire as Record<string, unknown>).prediction;
    // Absent is not the same as null: an older service that cannot answer must
    // not read as one that answered "no prediction".
    expect(() => parseAnalyzerV1AlignmentDescriptor(wire, ALIGNMENT_ID)).toThrow();
  });
});

describe('iteration series', () => {
  const wire = {
    schema_version: 1,
    definitions: { measured_ms: 'replica critical-path sum' },
    meta: { recommended_gpu_time_multiplier: 1.329, measured_phases: ['forward'] },
    iterations: [
      {
        iteration_id: 6,
        case_index: 0,
        iteration_type: 'prefill',
        stage: 'mixed',
        measured_ms: 6.8,
        simulated_ms: 6.1,
        delta_ms: -0.7,
        relative_diff_pct: -9.9,
        cumulative_delta_ms: -0.7,
        cumulative_relative_diff_pct: -9.9,
        measured_busy_union_ms: 8.9,
        measured_gpu_cycle_ms: 10.5,
        simulated_gpu_cycle_ms: 8.2,
        gpu_cycle_delta_ms: -2.3,
        gpu_cycle_relative_diff_pct: -21.9,
        gpu_cycle_cumulative_delta_ms: -2.3,
        gpu_cycle_cumulative_relative_diff_pct: -21.9,
      },
    ],
    sequences: {
      encoding: 'folded-v1',
      folding_policy: { kind: 'exact_contiguous_repeat' },
      representative_device_id: 0,
      device_ids: [0, 1],
      phases: {
        forward: {
          unique_sequences: [
            {
              sequence_id: 'sequence_a',
              expanded_kernel_count: 64,
              iterations: [6],
              program: [
                {
                  kernels: [
                    {
                      name: 'embed',
                      suggested_category: 'other',
                      label: { status: 'unmapped', cross_rank: 'independent' },
                    },
                  ],
                },
                {
                  repeat: {
                    count: 32,
                    body: {
                      kernels: [
                        {
                          name: 'nvjet',
                          suggested_category: 'gemm_or_cutlass',
                          label: {
                            status: 'mapped',
                            cross_rank: 'independent',
                            operation: 'layer.qkv_projection',
                            role: 'column-parallel QKV projection',
                            type: 'gemm',
                            simulated_slots: ['unified.attn_block.qkv_proj'],
                          },
                        },
                      ],
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    },
    breakdown_detail: {
      file: 'alignment_iteration_breakdowns.jsonl',
      encoding: 'one JSON object per line',
      byte_ranges: { '6': [0, 120], '7': [120, 90] },
    },
  };

  it('normalizes both segment shapes into one `{repeat, kernels}` form', () => {
    const series = parseAnalyzerV1AlignmentIterationSeries(wire);
    const program = series.sequences?.phases.forward[0].tracks[0]?.program;
    expect(program?.map((segment) => segment.repeat)).toEqual([1, 32]);
    expect(program?.[1].kernels[0].label.operation).toBe('layer.qkv_projection');
  });

  it('keeps only the iteration ids from the shard index, sorted', () => {
    const series = parseAnalyzerV1AlignmentIterationSeries({
      ...wire,
      breakdown_detail: {
        ...wire.breakdown_detail,
        byte_ranges: { '10': [0, 1], '2': [1, 1], invalid: [2, 1] },
      },
    });
    expect(series.breakdownDetail?.iterationIds).toEqual([2, 10]);
    expect(series.breakdownDetail?.file).toBe('alignment_iteration_breakdowns.jsonl');
  });

  it('passes definitions through untouched', () => {
    expect(parseAnalyzerV1AlignmentIterationSeries(wire).definitions.measured_ms).toBe(
      'replica critical-path sum',
    );
  });

  // A cycle runs to the NEXT iteration's boundary, so the analyzer writes null
  // for every cycle field of the last iteration in a capture. Every real
  // capture ends in one of these rows; rejecting it rejects the whole payload.
  it('accepts a trailing iteration whose gpu cycle was never closed', () => {
    const [first] = wire.iterations;
    const series = parseAnalyzerV1AlignmentIterationSeries({
      ...wire,
      iterations: [
        first,
        {
          ...first,
          iteration_id: 7,
          case_index: 1,
          measured_gpu_cycle_ms: null,
          simulated_gpu_cycle_ms: null,
          gpu_cycle_delta_ms: null,
          gpu_cycle_relative_diff_pct: null,
          gpu_cycle_cumulative_delta_ms: null,
          gpu_cycle_cumulative_relative_diff_pct: null,
        },
      ],
    });
    const last = series.iterations[1];
    expect(last.measuredMs).toBe(6.8);
    expect(last.measuredGpuCycleMs).toBeNull();
    expect(last.gpuCycleCumulativeRelativeDiffPct).toBeNull();
  });
});

describe('data-parallel union catalog (schema 4)', () => {
  const unionWire = {
    schema_version: 1,
    definitions: {},
    meta: { recommended_gpu_time_multiplier: 1.0, measured_phases: ['forward'] },
    iterations: [],
    sequences: {
      encoding: 'folded-v1',
      folding_policy: { rank_policy: 'union across devices' },
      // No rank stands for the replica when ranks diverge within a step.
      representative_device_id: null,
      device_ids: [0, 1],
      phases: {
        forward: {
          unique_sequences: [
            {
              sequence_id: 'sequence_decode',
              expanded_kernel_count: 2,
              occurrences: [
                { device_id: 0, iterations: [8, 9] },
                { device_id: 1, iterations: [9] },
              ],
              program: [
                {
                  kernels: [
                    {
                      name: 'embed',
                      suggested_category: 'other',
                      label: { status: 'unmapped', cross_rank: 'independent' },
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    },
  };

  it('accepts a null representative device and folds occurrences into one iteration list', () => {
    const series = parseAnalyzerV1AlignmentIterationSeries(unionWire);
    const sequences = series.sequences;
    expect(sequences).not.toBeNull();
    expect(sequences?.representativeDeviceId).toBeNull();
    const sequence = sequences?.phases.forward[0];
    // The union is sorted and de-duplicated, so `includes` and the median pick
    // that the mapping board does stay device-agnostic.
    expect(sequence?.iterations).toEqual([8, 9]);
    expect(sequence?.occurrences).toEqual([
      { deviceId: 0, iterations: [8, 9] },
      { deviceId: 1, iterations: [9] },
    ]);
  });
});

describe('compact multi-stream sequence catalog', () => {
  const sequenceSummary = {
    sequence_id: 'sequence_tracks',
    expanded_kernel_count: 2,
    occurrences: [{ device_id: 0, iterations: [9] }],
    total_ms: 4.5,
    tracks: [
      { track_index: 0, stream_role: 'primary', kernel_count: 1 },
      { track_index: 1, stream_role: 'concurrent', kernel_count: 1 },
    ],
  };

  it('keeps the v2 bootstrap catalog small and track-aware', () => {
    const series = parseAnalyzerV1AlignmentIterationSeries({
      schema_version: 2,
      definitions: {},
      meta: { recommended_gpu_time_multiplier: 1, measured_phases: ['forward'] },
      iterations: [],
      sequences: {
        encoding: 'folded-v2',
        folding_policy: {},
        representative_device_id: null,
        device_ids: [0],
        phases: { forward: { unique_sequences: [sequenceSummary] } },
      },
      sequence_detail: {
        file: 'alignment_sequence_programs.jsonl',
        encoding: 'one JSON object per line',
        byte_ranges: { forward: { sequence_tracks: [0, 42] } },
      },
    });
    const sequence = series.sequences?.phases.forward[0];
    expect(sequence?.totalMs).toBe(4.5);
    expect(sequence?.tracks.map((track) => track.program)).toEqual([null, null]);
    expect(series.sequenceDetail?.file).toBe('alignment_sequence_programs.jsonl');
  });

  it('decodes only the selected sequence programs into separate stream tracks', () => {
    const sequence = parseAnalyzerV1AlignmentSequence({
      ...sequenceSummary,
      phase: 'forward',
      tracks: sequenceSummary.tracks.map((track) => ({
        ...track,
        program: [
          {
            kernels: [
              {
                name: `kernel_${track.track_index}`,
                suggested_category: 'other',
                label: { status: 'unmapped', cross_rank: 'independent' },
              },
            ],
          },
        ],
      })),
    });
    expect(sequence.tracks).toHaveLength(2);
    expect(sequence.tracks[1]?.program?.[0]?.kernels[0]?.name).toBe('kernel_1');
  });
});

describe('timeline index', () => {
  const wire = {
    schema_version: 1,
    definitions: { anchor_ns: 'reference rank first kernel start' },
    meta: {
      anchor_rule: 'min kernel start over the reference rank.',
      selection_rule: 'every iteration in the capture, in iteration order.',
      time_base: 'capture-relative nanoseconds',
      time_origin_ns: 2580193260,
      reference_device_id: 0,
      measured_device_ids: [0, 1],
      recommended_gpu_time_multiplier: 1.329,
      iterations_available: 2040,
      iterations_emitted: 2040,
      iterations_reported: 32,
      host_timeline: {
        source: 'host_timeline.json',
        window_rule: 'the reference-rank GPU span unioned with the NVTX phases.',
        ownership_rule: 'a host event belongs to every iteration whose window it overlaps.',
        api_classes: ['kernel launch'],
        threads: [
          {
            global_tid: 287311904722692,
            device_id: null,
            process: 'VLLM::EngineCor',
            role: 'scheduler thread',
            main: true,
          },
        ],
        strings: ['forward'],
        unclosed_nvtx_marks: 0,
      },
    },
    iterations: [
      {
        iteration_id: 6,
        case_index: 0,
        iteration_type: 'prefill',
        stage: 'mixed',
        identity_sequence: 'sequence_a',
        selected_as: 'group_median',
        anchor_ns: 53805,
        span_ms: 10.5,
        busy_ms: 8.36,
        idle_ms: 2.14,
        idle_fraction: 0.2,
        gap_count: 396,
        has_host_lane: true,
        measured_ms: 6.84,
        simulated_ms: 6.16,
        relative_diff_pct: -9.9,
        measured_gpu_cycle_ms: 10.49,
        simulated_gpu_cycle_ms: 8.19,
      },
    ],
    kernel_names: { '1': 'embed', '7': 'nvjet' },
    operations: [
      {
        operation: 'layer.qkv_projection',
        role: 'column-parallel QKV projection',
        type: 'gemm',
        simulated_slots: ['unified.attn_block.qkv_proj'],
      },
    ],
    slot_multiplicity: [1, 32],
    sim_manifest: {
      slots: [
        { name: 'unified.embedding', kind: 'elementwise' },
        { name: 'unified.attn_block.qkv_proj', kind: 'single_gemm' },
      ],
      nodes: [
        { Sum: { children: { start: 1, end: 3 } } },
        { Leaf: 0 },
        { Scale: { n: 32, children: { start: 3, end: 4 } } },
        { Max: { overlap: 1.0, children: { start: 4, end: 5 } } },
        { Leaf: 1 },
      ],
    },
    iteration_detail: {
      file: 'alignment_timeline_iterations.jsonl',
      encoding: 'one JSON object per line',
      byte_ranges: { '6': [0, 100] },
    },
  };

  it('keeps the analyzer rules verbatim, on both the index and the host block', () => {
    const index = parseAnalyzerV1AlignmentTimelineIndex(wire);
    expect(index.meta.anchorRule).toBe('min kernel start over the reference rank.');
    expect(index.meta.hostTimeline?.ownershipRule).toBe(
      'a host event belongs to every iteration whose window it overlaps.',
    );
  });

  it('reports the emitted and reported counts separately, because they differ', () => {
    const index = parseAnalyzerV1AlignmentTimelineIndex(wire);
    expect(index.meta.iterationsEmitted).toBe(2040);
    expect(index.meta.iterationsReported).toBe(32);
  });

  it('extracts the manifest slots the modelled lane draws from', () => {
    const index = parseAnalyzerV1AlignmentTimelineIndex(wire);
    expect(index.simSlots.map((slot) => slot.kind)).toEqual(['elementwise', 'single_gemm']);
  });

  it('rejects a multiplicity vector that cannot address the manifest slots', () => {
    expect(() =>
      parseAnalyzerV1AlignmentTimelineIndex({ ...wire, slot_multiplicity: [1] }),
    ).toThrow(/one value per sim_manifest slot/);
  });

  it('decodes each cost-tree node into its own kind, so the walk stays exhaustive', () => {
    const index = parseAnalyzerV1AlignmentTimelineIndex(wire);
    expect(index.simNodes).toEqual([
      { kind: 'sum', children: [1, 3] },
      { kind: 'leaf', slotIndex: 0 },
      { kind: 'scale', repeats: 32, children: [3, 4] },
      { kind: 'max', overlap: 1, children: [4, 5] },
      { kind: 'leaf', slotIndex: 1 },
    ]);
  });

  it('leaves the cost tree empty when the payload carries no manifest', () => {
    const index = parseAnalyzerV1AlignmentTimelineIndex({ ...wire, sim_manifest: null });
    expect(index.simNodes).toEqual([]);
  });

  it('accepts an index row whose gpu cycle was never closed', () => {
    const index = parseAnalyzerV1AlignmentTimelineIndex({
      ...wire,
      iterations: [{ ...wire.iterations[0], measured_gpu_cycle_ms: null }],
    });
    expect(index.iterations[0].measuredGpuCycleMs).toBeNull();
    expect(index.iterations[0].spanMs).toBe(10.5);
  });

  it('degrades to a null host block for a capture with no sidecar', () => {
    const index = parseAnalyzerV1AlignmentTimelineIndex({
      ...wire,
      meta: { ...wire.meta, host_timeline: null },
    });
    expect(index.meta.hostTimeline).toBeNull();
    expect(index.iterations).toHaveLength(1);
  });
});

describe('per-iteration detail', () => {
  it('refuses a record for a different iteration than the one requested', () => {
    const record = {
      iteration_id: 7,
      case_index: 1,
      stage: 'decode',
      measured_ms: 0.75,
      measured_kernel_sum_ms: 1,
      simulated_leaf_workload_ms: 1,
      unmapped_measured_ms: 0,
      unmapped_simulated_ms: 0,
      measured_kernels: [],
      simulated_kernels: [],
      operation_summary: [
        {
          operation: 'sim.only',
          measured_ms: 0,
          measured_concurrent_hidden_ms: null,
          simulated_ms: 1,
          delta_ms: 1,
          relative_diff_pct: null,
        },
      ],
      phase_summary: [],
    };
    expect(() => parseAnalyzerV1AlignmentBreakdown(record, 6)).toThrow(/identity/);
    const parsed = parseAnalyzerV1AlignmentBreakdown(record, 7);
    expect(parsed.iterationId).toBe(7);
    expect(parsed.measuredCriticalPathMs).toBe(0.75);
    expect(parsed.operationSummary[0]).toMatchObject({
      measuredMs: 0,
      simulatedMs: 1,
      deltaMs: 1,
      relativeDiffPct: null,
    });
  });
});

describe('timeline iteration detail', () => {
  const wire = {
    iteration_id: 6,
    case_index: 0,
    iteration_type: 'decode',
    stage: 'mixed',
    identity_sequence: 'sequence_a',
    selected_as: 'group_median',
    anchor_ns: 1,
    gpu_span_ns: [1, 2],
    measured_gpu_cycle_ms: 1,
    simulated_gpu_cycle_ms: 1,
    measured: { critical_path_ms: 0, busy_union_ms: 0, kernels: [] },
    simulated: { total_ms: 1, slot_ms: [1], slot_op: ['layer.qkv_projection'] },
    operation_totals: [],
    host: null,
  };

  it('rejects slot labels that do not line up with timing values', () => {
    expect(() =>
      parseAnalyzerV1AlignmentTimelineIteration(
        { ...wire, simulated: { ...wire.simulated, slot_op: [] } },
        6,
      ),
    ).toThrow(/one value per slot_ms value/);
  });
});

describe('e2e half', () => {
  it('flattens the workload subject`s nested definitions with a dotted key', () => {
    const series = parseAnalyzerV1AlignmentWorkloadSeries({
      schema_version: 1,
      available: true,
      definitions: {
        grain: 'one scheduler iteration',
        iteration_cycle_ms: { measured: 'first kernel start to first kernel start' },
      },
      measured: null,
      simulated: null,
    });
    expect(series.definitions.grain).toBe('one scheduler iteration');
    expect(series.definitions['iteration_cycle_ms.measured']).toBe(
      'first kernel start to first kernel start',
    );
  });

  it('rejects workload columns that do not describe the same iterations', () => {
    expect(() =>
      parseAnalyzerV1AlignmentWorkloadSeries({
        schema_version: 1,
        available: true,
        definitions: {},
        measured: {
          iteration_id: [1],
          time_ms: [],
          iteration_cycle_ms: [1],
          prefill_tokens: [0],
          decode_batch_size: [1],
          scheduled_kv_tokens: [1],
        },
        simulated: null,
      }),
    ).toThrow(/one value per iteration_id/);
  });

  it('rejects CDF points and throughput bins whose columns have different lengths', () => {
    const curve = { key: 'ttft', label: 'TTFT', unit: 'ms', n: 1, x: [1], y_pct: [], markers: {} };
    expect(() =>
      parseAnalyzerV1AlignmentE2eSeries({
        schema_version: 1,
        definitions: {},
        latency_cdf_comparisons: [
          { key: 'ttft', label: 'TTFT', unit: 'ms', measured: curve, simulated: curve },
        ],
        throughput: null,
      }),
    ).toThrow(/one value per x value/);

    expect(() =>
      parseAnalyzerV1AlignmentE2eSeries({
        schema_version: 1,
        definitions: {},
        latency_cdf_comparisons: [],
        throughput: {
          t_start_ms: [0],
          t_end_ms: [],
          measured_output_tps: [1],
          simulated_output_tps: [1],
        },
      }),
    ).toThrow(/one value per t_start_ms value/);
  });

  it('accepts an e2e payload with no throughput bins', () => {
    const series = parseAnalyzerV1AlignmentE2eSeries({
      schema_version: 1,
      definitions: {},
      latency_cdf_comparisons: [],
      throughput: null,
    });
    expect(series.throughput).toBeNull();
    expect(series.throughputSummary).toEqual({});
  });
});
