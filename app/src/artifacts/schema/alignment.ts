import { z } from 'zod';

import type {
  AlignmentBreakdown,
  AlignmentDescriptor,
  AlignmentDetailIndex,
  AlignmentDistribution,
  AlignmentE2eReport,
  AlignmentE2eSeries,
  AlignmentHostEvent,
  AlignmentIterationReport,
  AlignmentIterationSeries,
  AlignmentSequence,
  AlignmentSequenceOccurrence,
  AlignmentSequences,
  AlignmentSubjectName,
  AlignmentSubjectResource,
  AlignmentTimelineIndex,
  AlignmentTimelineIteration,
  AlignmentWorkloadReport,
  AlignmentWorkloadSeries,
} from './alignmentTypes';
import { ALIGNMENT_SUBJECTS } from './alignmentTypes';

/**
 * Runtime schemas for the alignment protocol.
 *
 * The protocol uses two levels of strictness:
 * the descriptor is `.strict()` because `ui_service` writes it for this app
 * alone and an unexpected key there means the protocol moved, while reports
 * and payloads are plain objects because the analyzer writes them for several
 * consumers and may add a field for one of them without breaking this one.
 *
 * `definitions` passes through untouched. Every explanatory sentence the page
 * shows comes from there, so narrowing the map would be the app quietly
 * deciding which parts of the analyzer's own account of its numbers a reader
 * gets to see.
 */

const finite = z.number().finite();
const nonNegative = finite.nonnegative();
const count = z.number().int().nonnegative().safe();
const nonEmpty = z.string().min(1);
const definitions = z.record(z.string());
const alignmentId = z.string().regex(/^al_[a-z0-9_]{1,64}$/);
const nanoseconds = z.number().int().safe();

/** A GPU cycle runs from one iteration's anchor to the NEXT one's, so the last
 * iteration of a capture has no cycle and the analyzer writes null for every
 * cycle-derived field. Coercing that to zero would report the final iteration
 * as instantaneous and drag the cumulative curves with it. */
const cycleMs = finite.nullable();

/** The analyzer omits `min` on absolute-error blocks. */
const distribution = z
  .object({
    n: count,
    mean: finite,
    p50: finite,
    p90: finite,
    p99: finite,
    max: finite,
    min: finite.optional(),
  })
  .transform((value): AlignmentDistribution => ({
    n: value.n,
    mean: value.mean,
    p50: value.p50,
    p90: value.p90,
    p99: value.p99,
    max: value.max,
    min: value.min ?? null,
  }));

const detailIndexSchema = z.object({
  file: nonEmpty,
  encoding: z.string(),
  byte_ranges: z.record(z.tuple([count, count])),
});

function decodeDetailIndex(value: z.infer<typeof detailIndexSchema>): AlignmentDetailIndex {
  // Only the ids travel into the domain: the offsets are the service's business
  // and the app addresses an iteration by id, never by byte range.
  const iterationIds = Object.keys(value.byte_ranges)
    .map(Number)
    .filter(Number.isInteger)
    .sort((left, right) => left - right);
  return Object.freeze({
    file: value.file,
    encoding: value.encoding,
    iterationIds: Object.freeze(iterationIds),
  });
}

// ---- descriptor -----------------------------------------------------------

const subjectResourceSchema = z
  .object({
    status: z.enum(['ready', 'not_generated']),
    views: z.array(z.enum(['report', 'payload'])),
    // Whether one iteration reads on its own, which is a property of the
    // subject rather than a second address: every subject that has it is read
    // at `subjects/{name}/iterations/{id}`.
    has_iteration_detail: z.boolean(),
  })
  .strict()
  .refine((resource) => (resource.status === 'ready') === resource.views.length > 0, {
    message: 'a ready subject serves at least one view, and only a ready one serves any',
  });

const descriptorSchema = z
  .object({
    schema_version: z.literal(1),
    alignment_id: alignmentId,
    kind: z.literal('alignment'),
    display_name: nonEmpty,
    lifecycle: z
      .object({
        kernel_analysis: z.enum(['not_started', 'pending', 'complete']),
        e2e_analysis: z.enum(['not_started', 'pending', 'complete']),
      })
      .strict(),
    prediction: z.object({ prediction_id: nonEmpty, display_name: nonEmpty }).strict().nullable(),
    subjects: z.record(subjectResourceSchema),
  })
  .strict();

export function parseAnalyzerV1AlignmentDescriptor(
  input: unknown,
  expectedAlignmentId: string,
): AlignmentDescriptor {
  const descriptor = descriptorSchema.parse(input);
  if (descriptor.alignment_id !== expectedAlignmentId) {
    throw new Error('Alignment descriptor identity does not match the request.');
  }
  const subjects = {} as Record<AlignmentSubjectName, AlignmentSubjectResource>;
  for (const subject of ALIGNMENT_SUBJECTS) {
    const resource = descriptor.subjects[subject];
    if (resource === undefined) {
      throw new Error(`Alignment descriptor does not name the ${subject} subject.`);
    }
    subjects[subject] = Object.freeze({
      status: resource.status,
      hasIterationDetail: resource.has_iteration_detail,
    });
  }
  return Object.freeze({
    alignmentId: descriptor.alignment_id,
    displayName: descriptor.display_name,
    lifecycle: Object.freeze({
      kernelAnalysis: descriptor.lifecycle.kernel_analysis,
      e2eAnalysis: descriptor.lifecycle.e2e_analysis,
    }),
    prediction:
      descriptor.prediction === null
        ? null
        : Object.freeze({
            predictionId: descriptor.prediction.prediction_id,
            displayName: descriptor.prediction.display_name,
          }),
    subjects: Object.freeze(subjects),
  });
}

// ---- iteration subject ----------------------------------------------------

const pairedIterationSchema = z.object({
  iteration_id: count,
  case_index: count,
  iteration_type: z.string(),
  stage: z.string(),
  measured_ms: finite,
  measured_kernel_sum_ms: finite.optional(),
  simulated_ms: finite,
  delta_ms: finite,
  relative_diff_pct: finite,
  cumulative_delta_ms: finite,
  cumulative_relative_diff_pct: finite,
  measured_busy_union_ms: finite,
  measured_gpu_cycle_ms: cycleMs,
  simulated_gpu_cycle_ms: cycleMs,
  gpu_cycle_delta_ms: cycleMs,
  gpu_cycle_relative_diff_pct: cycleMs,
  gpu_cycle_cumulative_delta_ms: cycleMs,
  gpu_cycle_cumulative_relative_diff_pct: cycleMs,
});

type PairedIterationInput = z.infer<typeof pairedIterationSchema>;

function decodePairedIteration(row: PairedIterationInput) {
  return Object.freeze({
    iterationId: row.iteration_id,
    caseIndex: row.case_index,
    iterationType: row.iteration_type,
    stage: row.stage,
    measuredMs: row.measured_ms,
    measuredKernelSumMs: row.measured_kernel_sum_ms ?? row.measured_ms,
    simulatedMs: row.simulated_ms,
    deltaMs: row.delta_ms,
    relativeDiffPct: row.relative_diff_pct,
    cumulativeDeltaMs: row.cumulative_delta_ms,
    cumulativeRelativeDiffPct: row.cumulative_relative_diff_pct,
    measuredBusyUnionMs: row.measured_busy_union_ms,
    measuredGpuCycleMs: row.measured_gpu_cycle_ms,
    simulatedGpuCycleMs: row.simulated_gpu_cycle_ms,
    gpuCycleDeltaMs: row.gpu_cycle_delta_ms,
    gpuCycleRelativeDiffPct: row.gpu_cycle_relative_diff_pct,
    gpuCycleCumulativeDeltaMs: row.gpu_cycle_cumulative_delta_ms,
    gpuCycleCumulativeRelativeDiffPct: row.gpu_cycle_cumulative_relative_diff_pct,
  });
}

const mappedOperationSchema = z.object({
  operation: nonEmpty,
  role: z.string(),
  type: z.string(),
  simulated_slots: z.array(z.string()),
  measured_rows: count.optional(),
});

const decodeMappedOperation = (row: z.infer<typeof mappedOperationSchema>) =>
  Object.freeze({
    operation: row.operation,
    role: row.role,
    type: row.type,
    simulatedSlots: Object.freeze(row.simulated_slots),
    measuredRows: row.measured_rows ?? 0,
  });

const iterationReportSchema = z.object({
  schema_version: z.union([z.literal(1), z.literal(2)]),
  available: z.boolean(),
  definitions,
  meta: z.object({
    iterations: count,
    recommended_gpu_time_multiplier: finite.positive(),
    // A schema-4 union catalog has no representative device: data-parallel
    // ranks may run different sequences in the same step, so no single rank
    // stands for the replica.
    representative_device_id: count.nullable(),
    measured_device_ids: z.array(count),
    measured_phases: z.array(z.string()),
  }),
  iterations: z.array(pairedIterationSchema),
  kernels: z
    .array(
      z.object({
        row_id: nonEmpty,
        name: z.string(),
        category: z.string(),
        phase: z.string(),
        operation: z.string().nullable(),
        total_ms: nonNegative,
        mean_call_us: nonNegative,
        calls: count,
        calls_per_iteration: nonNegative,
        replica_calls: nonNegative,
        replica_calls_per_iteration: nonNegative,
        rank_launches: count,
        iterations: count,
        device_ids: z.array(count),
      }),
    )
    .default([]),
  mapping: z.object({
    configured: z.boolean(),
    coverage: z.object({
      measured_duration_fraction: nonNegative,
      measured_mapped_ms: nonNegative,
      measured_total_kernel_ms: nonNegative,
      simulated_workload_fraction: nonNegative,
      simulated_mapped_ms: nonNegative,
      simulated_total_leaf_workload_ms: nonNegative,
    }),
    operations: z.array(mappedOperationSchema),
    unmapped_measured_kernel_count: count.optional(),
    unmapped_measured_kernels: z
      .array(
        z.object({
          row_id: nonEmpty,
          name: z.string(),
          phase: z.string(),
          total_ms: nonNegative,
          calls: count,
          device_ids: z.array(count),
        }),
      )
      .default([]),
    unmapped_simulated_slots: z.array(
      z.object({ slot: z.string(), kind: z.string().optional(), total_ms: nonNegative }),
    ),
  }),
  operations: z.array(
    z.object({
      operation: nonEmpty,
      n_paired: count,
      missing_measured: count,
      missing_simulated: count,
      measured_ms: distribution,
      simulated_ms: distribution,
      delta_ms: distribution,
      relative_diff_pct: distribution,
      abs_relative_error_pct: distribution,
    }),
  ),
  total_iteration: z.object({
    delta_ms: distribution,
    relative_diff_pct: distribution,
    abs_relative_error_pct: distribution,
  }),
});

export function parseAnalyzerV1AlignmentIterationReport(input: unknown): AlignmentIterationReport {
  const report = iterationReportSchema.parse(input);
  return Object.freeze({
    available: report.available,
    definitions: Object.freeze(report.definitions),
    meta: Object.freeze({
      iterations: report.meta.iterations,
      recommendedGpuTimeMultiplier: report.meta.recommended_gpu_time_multiplier,
      representativeDeviceId: report.meta.representative_device_id,
      measuredDeviceIds: Object.freeze(report.meta.measured_device_ids),
      measuredPhases: Object.freeze(report.meta.measured_phases),
    }),
    iterations: Object.freeze(report.iterations.map(decodePairedIteration)),
    kernels: Object.freeze(
      report.kernels.map((row) =>
        Object.freeze({
          rowId: row.row_id,
          name: row.name,
          category: row.category,
          phase: row.phase,
          operation: row.operation,
          totalMs: row.total_ms,
          meanCallUs: row.mean_call_us,
          calls: row.calls,
          callsPerIteration: row.calls_per_iteration,
          replicaCalls: row.replica_calls,
          replicaCallsPerIteration: row.replica_calls_per_iteration,
          rankLaunches: row.rank_launches,
          iterations: row.iterations,
          deviceIds: Object.freeze(row.device_ids),
        }),
      ),
    ),
    mapping: Object.freeze({
      configured: report.mapping.configured,
      coverage: Object.freeze({
        measuredDurationFraction: report.mapping.coverage.measured_duration_fraction,
        measuredMappedMs: report.mapping.coverage.measured_mapped_ms,
        measuredTotalKernelMs: report.mapping.coverage.measured_total_kernel_ms,
        simulatedWorkloadFraction: report.mapping.coverage.simulated_workload_fraction,
        simulatedMappedMs: report.mapping.coverage.simulated_mapped_ms,
        simulatedTotalLeafWorkloadMs: report.mapping.coverage.simulated_total_leaf_workload_ms,
      }),
      operations: Object.freeze(report.mapping.operations.map(decodeMappedOperation)),
      unmappedMeasuredKernelCount:
        report.mapping.unmapped_measured_kernel_count ??
        report.mapping.unmapped_measured_kernels.length,
      unmappedMeasuredKernels: Object.freeze(
        report.mapping.unmapped_measured_kernels.map((row) =>
          Object.freeze({
            rowId: row.row_id,
            name: row.name,
            phase: row.phase,
            totalMs: row.total_ms,
            calls: row.calls,
            deviceIds: Object.freeze(row.device_ids),
          }),
        ),
      ),
      unmappedSimulatedSlots: Object.freeze(
        report.mapping.unmapped_simulated_slots.map((row) =>
          Object.freeze({ slot: row.slot, kind: row.kind ?? null, totalMs: row.total_ms }),
        ),
      ),
    }),
    operations: Object.freeze(
      report.operations.map((row) =>
        Object.freeze({
          operation: row.operation,
          nPaired: row.n_paired,
          missingMeasured: row.missing_measured,
          missingSimulated: row.missing_simulated,
          measuredMs: row.measured_ms,
          simulatedMs: row.simulated_ms,
          deltaMs: row.delta_ms,
          relativeDiffPct: row.relative_diff_pct,
          absRelativeErrorPct: row.abs_relative_error_pct,
        }),
      ),
    ),
    totalIteration: Object.freeze({
      deltaMs: report.total_iteration.delta_ms,
      relativeDiffPct: report.total_iteration.relative_diff_pct,
      absRelativeErrorPct: report.total_iteration.abs_relative_error_pct,
    }),
  });
}

const sequenceKernelSchema = z.object({
  name: z.string(),
  suggested_category: z.string(),
  label: z.object({
    status: z.string(),
    cross_rank: z.string(),
    operation: z.string().optional(),
    role: z.string().optional(),
    type: z.string().optional(),
    simulated_slots: z.array(z.string()).optional(),
  }),
});

/** A segment is either a literal run of kernels or a `repeat{n}` band around
 * one. Both forms normalize to `{repeat, kernels}` so a renderer never has to
 * branch on which one the labeler emitted. */
const sequenceSegmentSchema = z.union([
  z.object({ kernels: z.array(sequenceKernelSchema) }),
  z.object({
    repeat: z.object({ count: count, body: z.object({ kernels: z.array(sequenceKernelSchema) }) }),
  }),
]);

const sequenceProgramSchema = z.array(sequenceSegmentSchema);
const sequenceTrackSchema = z.object({
  track_index: count,
  stream_role: z.string(),
  kernel_count: count,
  program: sequenceProgramSchema.optional(),
});

const sequenceObjectSchema = z.object({
  sequence_id: nonEmpty,
  expanded_kernel_count: count,
  // Schema 2/3 record one device-agnostic iteration list; schema 4+
  // carries the device axis instead. Exactly one is present.
  iterations: z.array(count).optional(),
  occurrences: z.array(z.object({ device_id: count, iterations: z.array(count) })).optional(),
  total_ms: nonNegative.optional(),
  // Schema <=4 used one implicit stream. Schema 5 and the compact v2
  // catalog carry explicit tracks; catalog tracks omit their programs.
  program: sequenceProgramSchema.optional(),
  tracks: z.array(sequenceTrackSchema).optional(),
});

const validateSequenceAssignment = (sequence: z.infer<typeof sequenceObjectSchema>) =>
  (sequence.iterations === undefined) !== (sequence.occurrences === undefined);
const validateSequenceProgram = (sequence: z.infer<typeof sequenceObjectSchema>) =>
  (sequence.program === undefined) !== (sequence.tracks === undefined);

const sequenceSchema = sequenceObjectSchema
  .refine(validateSequenceAssignment, {
    message: 'sequence must carry either iterations or occurrences, not both',
  })
  .refine(validateSequenceProgram, {
    message: 'sequence must carry either a legacy program or explicit tracks, not both',
  });

const sequencesSchema = z.object({
  encoding: z.string(),
  folding_policy: z.record(z.unknown()),
  representative_device_id: count.nullable(),
  device_ids: z.array(count),
  phases: z.record(
    z.object({
      unique_sequences: z.array(sequenceSchema),
    }),
  ),
});

const decodeProgram = (program: z.infer<typeof sequenceProgramSchema>) =>
  Object.freeze(
    program.map((segment) =>
      'repeat' in segment
        ? Object.freeze({
            repeat: segment.repeat.count,
            kernels: Object.freeze(segment.repeat.body.kernels.map(decodeSequenceKernel)),
          })
        : Object.freeze({
            repeat: 1,
            kernels: Object.freeze(segment.kernels.map(decodeSequenceKernel)),
          }),
    ),
  );

function decodeSequenceKernel(kernel: z.infer<typeof sequenceKernelSchema>) {
  return Object.freeze({
    name: kernel.name,
    suggestedCategory: kernel.suggested_category,
    label: Object.freeze({
      status: kernel.label.status,
      crossRank: kernel.label.cross_rank,
      operation: kernel.label.operation,
      role: kernel.label.role,
      type: kernel.label.type,
      simulatedSlots: kernel.label.simulated_slots
        ? Object.freeze(kernel.label.simulated_slots)
        : undefined,
    }),
  });
}

function decodeSequences(value: z.infer<typeof sequencesSchema>): AlignmentSequences {
  // Normalize both catalog shapes onto one iteration list so every consumer
  // (counts, the representative iteration, `includes`) stays device-agnostic;
  // the per-device breakdown stays available beside it.
  const occurrencesOf = (sequence: {
    iterations?: readonly number[];
    occurrences?: readonly { device_id: number; iterations: readonly number[] }[];
  }): readonly AlignmentSequenceOccurrence[] =>
    Object.freeze(
      (sequence.occurrences ?? []).map((occurrence) =>
        Object.freeze({
          deviceId: occurrence.device_id,
          iterations: Object.freeze([...occurrence.iterations]),
        }),
      ),
    );
  const iterationsOf = (sequence: {
    iterations?: readonly number[];
    occurrences?: readonly { device_id: number; iterations: readonly number[] }[];
  }): readonly number[] =>
    sequence.iterations !== undefined
      ? Object.freeze([...sequence.iterations])
      : Object.freeze(
          [
            ...new Set((sequence.occurrences ?? []).flatMap((occurrence) => occurrence.iterations)),
          ].sort((left, right) => left - right),
        );
  const phases: Record<string, readonly AlignmentSequence[]> = {};
  for (const [phase, block] of Object.entries(value.phases)) {
    phases[phase] = Object.freeze(
      block.unique_sequences.map((sequence) =>
        Object.freeze({
          sequenceId: sequence.sequence_id,
          expandedKernelCount: sequence.expanded_kernel_count,
          iterations: iterationsOf(sequence),
          occurrences: occurrencesOf(sequence),
          totalMs: sequence.total_ms ?? null,
          tracks: Object.freeze(
            sequence.tracks !== undefined
              ? sequence.tracks.map((track) =>
                  Object.freeze({
                    trackIndex: track.track_index,
                    streamRole: track.stream_role,
                    kernelCount: track.kernel_count,
                    program: track.program === undefined ? null : decodeProgram(track.program),
                  }),
                )
              : [
                  Object.freeze({
                    trackIndex: 0,
                    streamRole: 'primary',
                    kernelCount: sequence.expanded_kernel_count,
                    program: decodeProgram(sequence.program ?? []),
                  }),
                ],
          ),
        }),
      ),
    );
  }
  return Object.freeze({
    encoding: value.encoding,
    foldingPolicy: Object.freeze(value.folding_policy),
    representativeDeviceId: value.representative_device_id,
    deviceIds: Object.freeze(value.device_ids),
    phases: Object.freeze(phases),
  });
}

const sequenceDetailSchema = sequenceObjectSchema
  .extend({ phase: z.string() })
  .refine(validateSequenceAssignment, {
    message: 'sequence must carry either iterations or occurrences, not both',
  })
  .refine(validateSequenceProgram, {
    message: 'sequence must carry either a legacy program or explicit tracks, not both',
  });

export function parseAnalyzerV1AlignmentSequence(input: unknown): AlignmentSequence;
export function parseAnalyzerV1AlignmentSequence(
  input: unknown,
  expectedPhase: string,
  expectedSequenceId: string,
): AlignmentSequence;
export function parseAnalyzerV1AlignmentSequence(
  input: unknown,
  expectedPhase?: string,
  expectedSequenceId?: string,
): AlignmentSequence {
  const wire = sequenceDetailSchema.parse(input);
  if ((expectedPhase === undefined) !== (expectedSequenceId === undefined)) {
    throw new Error('Alignment sequence identity requires both phase and sequence id.');
  }
  if (
    expectedPhase !== undefined &&
    expectedSequenceId !== undefined &&
    (wire.phase !== expectedPhase || wire.sequence_id !== expectedSequenceId)
  ) {
    throw new Error(
      `Alignment sequence identity does not match the request: expected ${expectedPhase}/${expectedSequenceId}, received ${wire.phase}/${wire.sequence_id}.`,
    );
  }
  const container = sequencesSchema.parse({
    encoding: 'selected-sequence',
    folding_policy: {},
    representative_device_id: null,
    device_ids: [],
    phases: { [wire.phase]: { unique_sequences: [wire] } },
  });
  return decodeSequences(container).phases[wire.phase][0];
}

const sequenceDetailIndexSchema = z.object({
  file: z.string(),
  encoding: z.string(),
  byte_ranges: z.record(z.record(z.tuple([count, count]))),
});

const iterationSeriesSchema = z.object({
  schema_version: z.union([z.literal(1), z.literal(2)]),
  definitions,
  meta: z.object({
    recommended_gpu_time_multiplier: finite.positive(),
    measured_phases: z.array(z.string()),
  }),
  iterations: z.array(pairedIterationSchema),
  sequences: sequencesSchema.nullish(),
  sequence_detail: sequenceDetailIndexSchema.nullish(),
  breakdown_detail: detailIndexSchema.nullish(),
});

export function parseAnalyzerV1AlignmentIterationSeries(input: unknown): AlignmentIterationSeries {
  const payload = iterationSeriesSchema.parse(input);
  return Object.freeze({
    definitions: Object.freeze(payload.definitions),
    meta: Object.freeze({
      recommendedGpuTimeMultiplier: payload.meta.recommended_gpu_time_multiplier,
      measuredPhases: Object.freeze(payload.meta.measured_phases),
    }),
    iterations: Object.freeze(payload.iterations.map(decodePairedIteration)),
    sequences: payload.sequences ? decodeSequences(payload.sequences) : null,
    sequenceDetail: payload.sequence_detail
      ? Object.freeze({
          file: payload.sequence_detail.file,
          encoding: payload.sequence_detail.encoding,
        })
      : null,
    breakdownDetail: payload.breakdown_detail ? decodeDetailIndex(payload.breakdown_detail) : null,
  });
}

const breakdownSchema = z.object({
  iteration_id: count,
  case_index: count,
  stage: z.string(),
  // Current analyzer payloads carry the canonical headline directly. Older
  // shards predate the field but their per-kernel duration_ms values already
  // sum to the then-current measured headline, so that is the exact fallback.
  measured_ms: nonNegative.optional(),
  measured_kernel_sum_ms: nonNegative,
  // Added without a schema bump. Old single-stream artifacts are equivalent
  // to zero hidden work, so absence has an exact backwards-compatible value.
  measured_concurrent_hidden_ms: nonNegative.optional(),
  // The iteration's modelled cost. `simulated_leaf_workload_ms` is the sum over
  // every fan-out child (one per EP rank / DP group), so under a Max fan-out it
  // is several times the cost actually paid; only the critical path is
  // comparable with the measured stack.
  //
  // Optional, and absent means absent — not zero. The analyzer began attributing
  // leaves through the cost tree on 2026-08-04 without bumping the report's
  // schema version, so a report produced before that carries the same version
  // and no attribution at all. A consumer that cannot show the difference
  // between the two stacks must say so rather than fall back to the folded sum,
  // which is what made the modelled stack several times too tall.
  simulated_critical_path_ms: nonNegative.optional(),
  simulated_leaf_workload_ms: nonNegative,
  unmapped_measured_ms: nonNegative,
  unmapped_simulated_ms: nonNegative,
  measured_kernels: z.array(
    z.object({
      row_id: z.string().nullish(),
      name: z.string(),
      category: z.string(),
      phase: z.string().nullish(),
      operation: z.string().nullish(),
      duration_ms: nonNegative,
      concurrent_hidden_ms: nonNegative.optional(),
      calls: count,
      first_start_ns: nanoseconds,
      device_ids: z.array(count),
    }),
  ),
  simulated_kernels: z.array(
    z.object({
      slot_index: count,
      name: z.string(),
      kind: z.string(),
      operation: z.string().nullish(),
      unit_ms: nonNegative,
      folded_ms: nonNegative,
      // Optional for the same reason as `simulated_critical_path_ms`: the two
      // arrive together or not at all.
      critical_path_ms: nonNegative.optional(),
      multiplicity: count,
    }),
  ),
  operation_summary: z.array(
    z.object({
      operation: nonEmpty,
      // An operation may exist on only one side of the mapping. The analyzer
      // preserves that distinction as null; the decoded stack normalizes the
      // missing side to zero time while keeping an undefined ratio as null.
      measured_ms: finite.nullable(),
      measured_concurrent_hidden_ms: nonNegative.nullish(),
      simulated_ms: finite.nullable(),
      delta_ms: finite.nullable(),
      relative_diff_pct: finite.nullable(),
    }),
  ),
  phase_summary: z.array(
    z.object({
      phase: z.string(),
      device_id: count,
      kernel_count: count,
      kernel_sum_ms: nonNegative,
      busy_union_ms: nonNegative,
    }),
  ),
});

export function parseAnalyzerV1AlignmentBreakdown(
  input: unknown,
  expectedIterationId: number,
): AlignmentBreakdown {
  const record = breakdownSchema.parse(input);
  if (record.iteration_id !== expectedIterationId) {
    throw new Error('Alignment breakdown identity does not match the request.');
  }
  const measuredCriticalPathMs =
    record.measured_ms ??
    record.measured_kernels.reduce((sum, kernel) => sum + kernel.duration_ms, 0);
  return Object.freeze({
    iterationId: record.iteration_id,
    caseIndex: record.case_index,
    stage: record.stage,
    measuredCriticalPathMs,
    measuredKernelSumMs: record.measured_kernel_sum_ms,
    measuredConcurrentHiddenMs: record.measured_concurrent_hidden_ms ?? 0,
    simulatedCriticalPathMs: record.simulated_critical_path_ms ?? null,
    simulatedLeafWorkloadMs: record.simulated_leaf_workload_ms,
    unmappedMeasuredMs: record.unmapped_measured_ms,
    unmappedSimulatedMs: record.unmapped_simulated_ms,
    measuredKernels: Object.freeze(
      record.measured_kernels.map((kernel) =>
        Object.freeze({
          rowId: kernel.row_id ?? null,
          name: kernel.name,
          category: kernel.category,
          phase: kernel.phase ?? null,
          operation: kernel.operation ?? null,
          durationMs: kernel.duration_ms,
          concurrentHiddenMs: kernel.concurrent_hidden_ms ?? 0,
          calls: kernel.calls,
          firstStartNs: kernel.first_start_ns,
          deviceIds: Object.freeze(kernel.device_ids),
        }),
      ),
    ),
    simulatedKernels: Object.freeze(
      record.simulated_kernels.map((slot) =>
        Object.freeze({
          slotIndex: slot.slot_index,
          name: slot.name,
          kind: slot.kind,
          operation: slot.operation ?? null,
          unitMs: slot.unit_ms,
          foldedMs: slot.folded_ms,
          criticalPathMs: slot.critical_path_ms ?? null,
          multiplicity: slot.multiplicity,
        }),
      ),
    ),
    operationSummary: Object.freeze(
      record.operation_summary.map((row) => {
        const measuredMs = row.measured_ms ?? 0;
        const simulatedMs = row.simulated_ms ?? 0;
        return Object.freeze({
          operation: row.operation,
          measuredMs,
          measuredConcurrentHiddenMs: row.measured_concurrent_hidden_ms ?? 0,
          simulatedMs,
          deltaMs: row.delta_ms ?? simulatedMs - measuredMs,
          relativeDiffPct: row.relative_diff_pct,
        });
      }),
    ),
    phaseSummary: Object.freeze(
      record.phase_summary.map((row) =>
        Object.freeze({
          phase: row.phase,
          deviceId: row.device_id,
          kernelCount: row.kernel_count,
          kernelSumMs: row.kernel_sum_ms,
          busyUnionMs: row.busy_union_ms,
        }),
      ),
    ),
  });
}

// ---- timeline subject -----------------------------------------------------

const hostEventSchema = z.union([
  z.tuple([nanoseconds, count, count, count]),
  z.tuple([nanoseconds, count, count, count, count.nullable()]),
]);
const hostLaneSchema = z.record(z.array(hostEventSchema));

const hostTimelineSchema = z.object({
  source: z.string(),
  window_rule: nonEmpty,
  ownership_rule: nonEmpty,
  api_classes: z.array(z.string()),
  threads: z.array(
    z.object({
      global_tid: z.number().int(),
      device_id: count.nullable(),
      process: z.string(),
      role: z.string(),
      main: z.boolean(),
    }),
  ),
  strings: z.array(z.string()),
  unclosed_nvtx_marks: count,
});

/**
 * One flattened cost-tree node, in the sim's serde encoding.
 *
 * `children` is a half-open range into the same array and a parent always
 * precedes its children, so a placement walk from index 0 visits the tree
 * without a lookup table. The four shapes are the sim's own aggregation kinds;
 * decoding them into a discriminated union keeps the walk exhaustive instead of
 * defaulting an unrecognised node to a leaf.
 */
const childRange = z
  .object({ start: count, end: count })
  .transform((range) => Object.freeze([range.start, range.end] as const));
const costNodeSchema = z.union([
  z.object({ Leaf: count }).transform((node) => ({ kind: 'leaf' as const, slotIndex: node.Leaf })),
  z
    .object({ Sum: z.object({ children: childRange }) })
    .transform((node) => ({ kind: 'sum' as const, children: node.Sum.children })),
  z.object({ Max: z.object({ overlap: finite, children: childRange }) }).transform((node) => ({
    kind: 'max' as const,
    overlap: node.Max.overlap,
    children: node.Max.children,
  })),
  z.object({ Scale: z.object({ n: count, children: childRange }) }).transform((node) => ({
    kind: 'scale' as const,
    repeats: node.Scale.n,
    children: node.Scale.children,
  })),
]);

/** The device the timeline's reference lane is drawn from. */
function referenceDeviceOf(reported: number | null, measured: readonly number[]): number {
  if (reported !== null) return reported;
  if (measured.length === 0) {
    throw new Error('Alignment timeline names no measured device to draw a reference lane from.');
  }
  return Math.min(...measured);
}

const timelineIndexSchema = z
  .object({
    schema_version: z.literal(1),
    definitions,
    meta: z.object({
      anchor_rule: nonEmpty,
      selection_rule: nonEmpty,
      time_base: nonEmpty,
      time_origin_ns: nanoseconds,
      // Null on a report whose capture has no single representative device —
      // eight DP ranks each running their own kernel sequence. The lane is
      // still drawn from one of them, so the decoder falls back to the lowest
      // measured device, which is the rule the analyzer applies per iteration.
      reference_device_id: count.nullable(),
      measured_device_ids: z.array(count),
      recommended_gpu_time_multiplier: finite.positive(),
      iterations_available: count,
      iterations_emitted: count,
      iterations_reported: count,
      host_timeline: hostTimelineSchema.nullish(),
    }),
    iterations: z.array(
      z.object({
        iteration_id: count,
        case_index: count,
        iteration_type: z.string(),
        stage: z.string(),
        identity_sequence: z.string(),
        selected_as: z.string(),
        anchor_ns: nanoseconds,
        span_ms: nonNegative,
        busy_ms: nonNegative,
        idle_ms: finite,
        idle_fraction: finite,
        gap_count: count,
        has_host_lane: z.boolean(),
        measured_ms: finite,
        simulated_ms: finite,
        relative_diff_pct: finite,
        measured_gpu_cycle_ms: cycleMs,
        simulated_gpu_cycle_ms: cycleMs,
      }),
    ),
    kernel_names: z.record(z.string()),
    operations: z.array(mappedOperationSchema),
    slot_multiplicity: z.array(count),
    sim_manifest: z
      .object({
        slots: z.array(z.object({ name: z.string(), kind: z.string() })),
        nodes: z.array(costNodeSchema).optional(),
      })
      .nullish(),
    iteration_detail: detailIndexSchema.nullish(),
  })
  .superRefine((payload, context) => {
    if (
      payload.sim_manifest !== null &&
      payload.sim_manifest !== undefined &&
      payload.slot_multiplicity.length !== payload.sim_manifest.slots.length
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['slot_multiplicity'],
        message: 'slot_multiplicity must have one value per sim_manifest slot',
      });
    }
  });

export function parseAnalyzerV1AlignmentTimelineIndex(input: unknown): AlignmentTimelineIndex {
  const payload = timelineIndexSchema.parse(input);
  const host = payload.meta.host_timeline;
  const kernelNames: Record<number, string> = {};
  for (const [id, name] of Object.entries(payload.kernel_names)) kernelNames[Number(id)] = name;
  return Object.freeze({
    definitions: Object.freeze(payload.definitions),
    meta: Object.freeze({
      anchorRule: payload.meta.anchor_rule,
      selectionRule: payload.meta.selection_rule,
      timeBase: payload.meta.time_base,
      timeOriginNs: payload.meta.time_origin_ns,
      referenceDeviceId: referenceDeviceOf(
        payload.meta.reference_device_id,
        payload.meta.measured_device_ids,
      ),
      measuredDeviceIds: Object.freeze(payload.meta.measured_device_ids),
      recommendedGpuTimeMultiplier: payload.meta.recommended_gpu_time_multiplier,
      iterationsAvailable: payload.meta.iterations_available,
      iterationsEmitted: payload.meta.iterations_emitted,
      iterationsReported: payload.meta.iterations_reported,
      hostTimeline: host
        ? Object.freeze({
            source: host.source,
            windowRule: host.window_rule,
            ownershipRule: host.ownership_rule,
            apiClasses: Object.freeze(host.api_classes),
            threads: Object.freeze(
              host.threads.map((thread) =>
                Object.freeze({
                  globalTid: thread.global_tid,
                  deviceId: thread.device_id,
                  process: thread.process,
                  role: thread.role,
                  main: thread.main,
                }),
              ),
            ),
            strings: Object.freeze(host.strings),
            unclosedNvtxMarks: host.unclosed_nvtx_marks,
          })
        : null,
    }),
    iterations: Object.freeze(
      payload.iterations.map((row) =>
        Object.freeze({
          iterationId: row.iteration_id,
          caseIndex: row.case_index,
          iterationType: row.iteration_type,
          stage: row.stage,
          identitySequence: row.identity_sequence,
          selectedAs: row.selected_as,
          anchorNs: row.anchor_ns,
          spanMs: row.span_ms,
          busyMs: row.busy_ms,
          idleMs: row.idle_ms,
          idleFraction: row.idle_fraction,
          gapCount: row.gap_count,
          hasHostLane: row.has_host_lane,
          measuredMs: row.measured_ms,
          simulatedMs: row.simulated_ms,
          relativeDiffPct: row.relative_diff_pct,
          measuredGpuCycleMs: row.measured_gpu_cycle_ms,
          simulatedGpuCycleMs: row.simulated_gpu_cycle_ms,
        }),
      ),
    ),
    kernelNames: Object.freeze(kernelNames),
    operations: Object.freeze(payload.operations.map(decodeMappedOperation)),
    slotMultiplicity: Object.freeze(payload.slot_multiplicity),
    simSlots: Object.freeze(
      (payload.sim_manifest?.slots ?? []).map((slot) =>
        Object.freeze({ name: slot.name, kind: slot.kind }),
      ),
    ),
    simNodes: Object.freeze((payload.sim_manifest?.nodes ?? []).map((node) => Object.freeze(node))),
    iterationDetail: payload.iteration_detail ? decodeDetailIndex(payload.iteration_detail) : null,
  });
}

const timelineIterationSchema = z
  .object({
    iteration_id: count,
    case_index: count,
    iteration_type: z.string(),
    stage: z.string(),
    identity_sequence: z.string(),
    selected_as: z.string(),
    anchor_ns: nanoseconds,
    gpu_span_ns: z.tuple([nanoseconds, nanoseconds]),
    measured_gpu_cycle_ms: cycleMs,
    simulated_gpu_cycle_ms: cycleMs,
    measured: z.object({
      critical_path_ms: nonNegative,
      busy_union_ms: nonNegative,
      kernels: z.array(
        z.object({
          name_id: count,
          row: z.string(),
          cat: z.string(),
          ph: z.string(),
          op: z.string().nullish(),
          sync: z.boolean(),
          occ_ns: nanoseconds,
          // `[device, start, end, correlation, track]`. The trailing elements
          // arrived one analyzer version at a time, so every prefix stays
          // valid: an older payload simply has no track and reads as track 0.
          iv: z.array(
            z.union([
              z.tuple([count, nanoseconds, nanoseconds]),
              z.tuple([count, nanoseconds, nanoseconds, count.nullable()]),
              z.tuple([count, nanoseconds, nanoseconds, count.nullable(), count]),
            ]),
          ),
        }),
      ),
    }),
    simulated: z.object({
      total_ms: nonNegative,
      slot_ms: z.array(nonNegative),
      slot_op: z.array(z.string().nullable()),
    }),
    operation_totals: z.array(
      z.object({
        op: nonEmpty,
        measured_ms: finite,
        simulated_ms: finite,
        measured_occurrences: count,
        simulated_occurrences: count,
        occurrence_ratio: finite,
      }),
    ),
    host: z
      .object({
        window_ns: z.tuple([nanoseconds, nanoseconds]),
        nvtx: hostLaneSchema,
        api: hostLaneSchema,
      })
      .nullish(),
  })
  .superRefine((payload, context) => {
    if (payload.simulated.slot_ms.length !== payload.simulated.slot_op.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['simulated', 'slot_op'],
        message: 'slot_op must have one value per slot_ms value',
      });
    }
  });

function decodeHostLane(lane: z.infer<typeof hostLaneSchema>) {
  const byThread: Record<number, readonly AlignmentHostEvent[]> = {};
  for (const [threadIndex, events] of Object.entries(lane)) {
    byThread[Number(threadIndex)] = Object.freeze(events);
  }
  return Object.freeze(byThread);
}

export function parseAnalyzerV1AlignmentTimelineIteration(
  input: unknown,
  expectedIterationId: number,
): AlignmentTimelineIteration {
  const record = timelineIterationSchema.parse(input);
  if (record.iteration_id !== expectedIterationId) {
    throw new Error('Alignment timeline iteration identity does not match the request.');
  }
  return Object.freeze({
    iterationId: record.iteration_id,
    caseIndex: record.case_index,
    iterationType: record.iteration_type,
    stage: record.stage,
    identitySequence: record.identity_sequence,
    selectedAs: record.selected_as,
    anchorNs: record.anchor_ns,
    gpuSpanNs: Object.freeze(record.gpu_span_ns),
    measuredGpuCycleMs: record.measured_gpu_cycle_ms,
    simulatedGpuCycleMs: record.simulated_gpu_cycle_ms,
    measured: Object.freeze({
      criticalPathMs: record.measured.critical_path_ms,
      busyUnionMs: record.measured.busy_union_ms,
      kernels: Object.freeze(
        record.measured.kernels.map((kernel) =>
          Object.freeze({
            nameId: kernel.name_id,
            rowId: kernel.row,
            category: kernel.cat,
            phase: kernel.ph,
            operation: kernel.op ?? null,
            synchronizing: kernel.sync,
            occurrenceNs: kernel.occ_ns,
            intervals: Object.freeze(kernel.iv),
          }),
        ),
      ),
    }),
    simulated: Object.freeze({
      totalMs: record.simulated.total_ms,
      slotMs: Object.freeze(record.simulated.slot_ms),
      slotOperation: Object.freeze(record.simulated.slot_op),
    }),
    operationTotals: Object.freeze(
      record.operation_totals.map((row) =>
        Object.freeze({
          operation: row.op,
          measuredMs: row.measured_ms,
          simulatedMs: row.simulated_ms,
          measuredOccurrences: row.measured_occurrences,
          simulatedOccurrences: row.simulated_occurrences,
          occurrenceRatio: row.occurrence_ratio,
        }),
      ),
    ),
    host: record.host
      ? Object.freeze({
          windowNs: Object.freeze(record.host.window_ns),
          nvtx: decodeHostLane(record.host.nvtx),
          api: decodeHostLane(record.host.api),
        })
      : null,
  });
}

// ---- e2e half ------------------------------------------------------------

const workloadSideSchema = z
  .object({
    iteration_id: z.array(count),
    time_ms: z.array(finite),
    iteration_cycle_ms: z.array(finite.nullable()),
    prefill_tokens: z.array(count),
    decode_batch_size: z.array(count),
    scheduled_kv_tokens: z.array(count),
  })
  .superRefine((side, context) => {
    const expectedLength = side.iteration_id.length;
    for (const [field, values] of Object.entries(side)) {
      if (values.length !== expectedLength) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} must have one value per iteration_id`,
        });
      }
    }
  });

const decodeWorkloadSide = (side: z.infer<typeof workloadSideSchema>) =>
  Object.freeze({
    iterationId: Object.freeze(side.iteration_id),
    timeMs: Object.freeze(side.time_ms),
    iterationCycleMs: Object.freeze(side.iteration_cycle_ms),
    prefillTokens: Object.freeze(side.prefill_tokens),
    decodeBatchSize: Object.freeze(side.decode_batch_size),
    scheduledKvTokens: Object.freeze(side.scheduled_kv_tokens),
  });

const workloadSeriesSchema = z.object({
  schema_version: z.literal(1),
  available: z.boolean(),
  definitions: z.record(z.unknown()),
  measured: workloadSideSchema.nullish(),
  simulated: workloadSideSchema.nullish(),
});

/** The workload subject nests a few definitions one level deep
 * (`iteration_cycle_ms.measured`). Flatten with a dotted key so the glossary
 * stays one flat list of term-to-sentence, still verbatim. */
function flattenDefinitions(input: Readonly<Record<string, unknown>>): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') flat[key] = value;
    else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      for (const [nested, sentence] of Object.entries(value as Record<string, unknown>)) {
        if (typeof sentence === 'string') flat[`${key}.${nested}`] = sentence;
      }
    }
  }
  return flat;
}

export function parseAnalyzerV1AlignmentWorkloadSeries(input: unknown): AlignmentWorkloadSeries {
  const payload = workloadSeriesSchema.parse(input);
  return Object.freeze({
    available: payload.available,
    definitions: Object.freeze(flattenDefinitions(payload.definitions)),
    measured: payload.measured ? decodeWorkloadSide(payload.measured) : null,
    simulated: payload.simulated ? decodeWorkloadSide(payload.simulated) : null,
  });
}

const workloadReportSchema = z.object({
  schema_version: z.literal(1),
  available: z.boolean(),
  definitions: z.record(z.unknown()),
  meta: z.record(z.unknown()),
  metrics: z.record(z.object({ measured: distribution, simulated: distribution })),
});

export function parseAnalyzerV1AlignmentWorkloadReport(input: unknown): AlignmentWorkloadReport {
  const report = workloadReportSchema.parse(input);
  return Object.freeze({
    available: report.available,
    definitions: Object.freeze(flattenDefinitions(report.definitions)),
    meta: Object.freeze(report.meta),
    metrics: Object.freeze(report.metrics),
  });
}

const cdfCurveSchema = z
  .object({
    key: nonEmpty,
    label: z.string(),
    unit: z.string(),
    n: count,
    x: z.array(finite),
    y_pct: z.array(finite),
    markers: z.record(finite),
  })
  .superRefine((curve, context) => {
    if (curve.x.length !== curve.y_pct.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['y_pct'],
        message: 'y_pct must have one value per x value',
      });
    }
  });

const throughputSeriesSchema = z
  .object({
    t_start_ms: z.array(finite),
    t_end_ms: z.array(finite),
    measured_output_tps: z.array(finite),
    simulated_output_tps: z.array(finite),
  })
  .superRefine((series, context) => {
    const expectedLength = series.t_start_ms.length;
    for (const [field, values] of Object.entries(series)) {
      if (values.length !== expectedLength) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} must have one value per t_start_ms value`,
        });
      }
    }
  });

const decodeCdfCurve = (curve: z.infer<typeof cdfCurveSchema>) =>
  Object.freeze({
    key: curve.key,
    label: curve.label,
    unit: curve.unit,
    n: curve.n,
    x: Object.freeze(curve.x),
    yPct: Object.freeze(curve.y_pct),
    markers: Object.freeze(curve.markers),
  });

const e2eSeriesSchema = z.object({
  schema_version: z.literal(1),
  definitions,
  latency_cdf_comparisons: z.array(
    z.object({
      key: nonEmpty,
      label: z.string(),
      unit: z.string(),
      measured: cdfCurveSchema,
      simulated: cdfCurveSchema,
    }),
  ),
  throughput: throughputSeriesSchema.nullish(),
  throughput_summary: z.record(finite).default({}),
});

export function parseAnalyzerV1AlignmentE2eSeries(input: unknown): AlignmentE2eSeries {
  const payload = e2eSeriesSchema.parse(input);
  return Object.freeze({
    definitions: Object.freeze(payload.definitions),
    latencyCdfComparisons: Object.freeze(
      payload.latency_cdf_comparisons.map((comparison) =>
        Object.freeze({
          key: comparison.key,
          label: comparison.label,
          unit: comparison.unit,
          measured: decodeCdfCurve(comparison.measured),
          simulated: decodeCdfCurve(comparison.simulated),
        }),
      ),
    ),
    throughput: payload.throughput
      ? Object.freeze({
          tStartMs: Object.freeze(payload.throughput.t_start_ms),
          tEndMs: Object.freeze(payload.throughput.t_end_ms),
          measuredOutputTps: Object.freeze(payload.throughput.measured_output_tps),
          simulatedOutputTps: Object.freeze(payload.throughput.simulated_output_tps),
        })
      : null,
    throughputSummary: Object.freeze(payload.throughput_summary),
  });
}

const e2eReportSchema = z.object({
  schema_version: z.literal(1),
  available: z.boolean(),
  definitions,
  meta: z.record(z.unknown()),
  latency: z.record(z.object({ measured_ms: distribution, simulated_ms: distribution })),
  throughput: z.record(finite),
});

export function parseAnalyzerV1AlignmentE2eReport(input: unknown): AlignmentE2eReport {
  const report = e2eReportSchema.parse(input);
  const latency: Record<
    string,
    { measuredMs: AlignmentDistribution; simulatedMs: AlignmentDistribution }
  > = {};
  for (const [key, block] of Object.entries(report.latency)) {
    latency[key] = Object.freeze({
      measuredMs: block.measured_ms,
      simulatedMs: block.simulated_ms,
    });
  }
  return Object.freeze({
    available: report.available,
    definitions: Object.freeze(report.definitions),
    meta: Object.freeze(report.meta),
    latency: Object.freeze(latency),
    throughput: Object.freeze(report.throughput),
  });
}
