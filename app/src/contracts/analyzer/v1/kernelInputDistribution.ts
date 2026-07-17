import { z, type ZodIssue } from 'zod';

import type {
  KernelInputDistribution,
  KernelInputPosition,
} from '../../../domain/kernelInputDistribution';
import type { SubjectResult } from '../../../domain/subject';
import {
  duplicateKeyIssues,
  finiteNumber,
  formatZodIssue,
  incompatiblePayload,
  nonNegativeCount,
  nonNegativeNumber,
  positiveCount,
  sourceLogDirIssue,
  unsupportedV1Payload,
  wireIdentityString,
  type AnalyzerV1PayloadDecodeOptions,
} from './subjectDecode';

const projectionSchema = z.enum(['categorical', 'feature_1d', 'raw_2d', 'pca']);
const selectionSchema = z.object({
  backend_index: nonNegativeCount.max(255),
  backend_name: wireIdentityString,
  count: positiveCount,
  ratio: nonNegativeNumber.max(1),
});
const pointSchema = z.object({
  x: finiteNumber,
  y: finiteNumber,
  backend_index: nonNegativeCount.max(255),
  backend_name: wireIdentityString,
  count: positiveCount,
});
const positionSchema = z.object({
  name: wireIdentityString,
  kind: wireIdentityString,
  candidate_backends: z.array(wireIdentityString).min(1),
  selection: z.array(selectionSchema).min(1),
  projection: projectionSchema,
  axis_labels: z.tuple([z.string(), z.string()]),
  explained_variance: z.tuple([nonNegativeNumber.max(1), nonNegativeNumber.max(1)]).nullable(),
  points: z.array(pointSchema).min(1),
});
const definitionsSchema = z.record(wireIdentityString);
const readySchema = z.object({
  schema_version: z.literal(1),
  available: z.literal(true),
  meta: z.object({
    log_dir: wireIdentityString,
    sample_stride: positiveCount,
    sampled_rows: positiveCount,
    num_positions_plotted: positiveCount,
    num_positions_multi_backend: nonNegativeCount,
    num_positions_manifest: positiveCount,
    num_positions_omitted: nonNegativeCount,
    num_positions_without_candidates: nonNegativeCount,
    skipped_not_executed_slots: nonNegativeCount,
    skipped_empty_input_slots: nonNegativeCount,
    max_points_per_position: positiveCount,
  }),
  positions: z.array(positionSchema).min(1),
  definitions: definitionsSchema,
});
const unavailableSchema = z.object({
  schema_version: z.literal(1),
  meta: z.object({
    log_dir: wireIdentityString,
    available: z.literal(false),
    reason: z.string().trim().min(1),
  }),
  positions: z.array(z.unknown()).length(0),
});
const wireSchema = z.union([readySchema, unavailableSchema]);

type ReadyWire = z.infer<typeof readySchema>;
type Wire = z.infer<typeof wireSchema>;
type UnavailableWire = z.infer<typeof unavailableSchema>;

function isUnavailable(wire: Wire): wire is UnavailableWire {
  return !('available' in wire) || wire.available !== true;
}

function wireFormatIssues(input: unknown, fallback: readonly ZodIssue[]): string[] {
  if (typeof input !== 'object' || input === null) return fallback.map(formatZodIssue);
  if ('available' in input && input.available === true) {
    const ready = readySchema.safeParse(input);
    if (!ready.success) return ready.error.issues.map(formatZodIssue);
  }
  if ('meta' in input && typeof input.meta === 'object' && input.meta !== null) {
    const unavailable = unavailableSchema.safeParse(input);
    if (!unavailable.success) return unavailable.error.issues.map(formatZodIssue);
  }
  return fallback.map(formatZodIssue);
}

function positionIssues(position: ReadyWire['positions'][number], index: number): string[] {
  const path = `positions.${index}`;
  const issues = [
    ...duplicateKeyIssues(`${path}.selection`, position.selection, (row) =>
      String(row.backend_index),
    ),
  ];
  const selections = new Map(position.selection.map((row) => [row.backend_index, row]));
  const selectionCount = position.selection.reduce((total, row) => total + row.count, 0);
  const pointCount = position.points.reduce((total, point) => total + point.count, 0);
  const ratioTotal = position.selection.reduce((total, row) => total + row.ratio, 0);
  if (selectionCount !== pointCount) {
    issues.push(
      `${path}.points: weighted count ${pointCount} does not equal selection total ${selectionCount}`,
    );
  }
  if (Math.abs(ratioTotal - 1) > 1e-6) {
    issues.push(`${path}.selection: ratios sum to ${ratioTotal}, expected 1`);
  }
  position.selection.forEach((row, selectionIndex) => {
    const expectedRatio = row.count / selectionCount;
    if (Math.abs(row.ratio - expectedRatio) > 1e-6) {
      issues.push(
        `${path}.selection.${selectionIndex}.ratio: ${row.ratio} disagrees with count ratio ${expectedRatio}`,
      );
    }
  });
  position.points.forEach((point, pointIndex) => {
    const selection = selections.get(point.backend_index);
    if (selection === undefined) {
      issues.push(`${path}.points.${pointIndex}.backend_index: missing from selection`);
    } else if (selection.backend_name !== point.backend_name) {
      issues.push(`${path}.points.${pointIndex}.backend_name: disagrees with selection`);
    }
  });
  if (position.projection === 'pca') {
    if (position.explained_variance === null) {
      issues.push(`${path}.explained_variance: required for pca projection`);
    } else if (position.explained_variance[0] + position.explained_variance[1] > 1 + 1e-9) {
      issues.push(`${path}.explained_variance: variance ratios must sum to at most 1`);
    }
  } else if (position.explained_variance !== null) {
    issues.push(`${path}.explained_variance: must be null for ${position.projection}`);
  }
  if (
    position.projection === 'raw_2d' &&
    position.axis_labels.some((label) => label.length === 0)
  ) {
    issues.push(`${path}.axis_labels: raw_2d requires two labels`);
  }
  if (position.projection === 'feature_1d' && position.axis_labels[0].length === 0) {
    issues.push(`${path}.axis_labels.0: feature_1d requires a value-axis label`);
  }
  return issues;
}

function semanticIssues(wire: ReadyWire): string[] {
  const issues = duplicateKeyIssues('positions', wire.positions, (position) => position.name);
  if (wire.meta.num_positions_plotted !== wire.positions.length) {
    issues.push(
      `meta.num_positions_plotted: expected ${wire.positions.length}, got ${wire.meta.num_positions_plotted}`,
    );
  }
  wire.positions.forEach((position, index) => {
    if (index > 0 && position.name < wire.positions[index - 1].name) {
      issues.push(`positions.${index}.name: positions must be sorted by name`);
    }
    issues.push(...positionIssues(position, index));
  });
  return issues;
}

function toPosition(position: ReadyWire['positions'][number]): KernelInputPosition {
  return {
    name: position.name,
    kind: position.kind,
    candidateBackends: [...position.candidate_backends],
    selection: position.selection.map((row) => ({
      backendIndex: row.backend_index,
      backendName: row.backend_name,
      count: row.count,
      ratio: row.ratio,
    })),
    projection: position.projection,
    axisLabels: position.axis_labels,
    explainedVariance: position.explained_variance,
    points: position.points.map((point) => ({
      x: point.x,
      y: point.y,
      backendIndex: point.backend_index,
      backendName: point.backend_name,
      count: point.count,
    })),
  };
}

function toDomain(wire: ReadyWire): KernelInputDistribution {
  return {
    positions: wire.positions.map(toPosition),
    sampling: {
      stride: wire.meta.sample_stride,
      sampledRows: wire.meta.sampled_rows,
      maxPointsPerPosition: wire.meta.max_points_per_position,
    },
    definitions: { ...wire.definitions },
  };
}

export type KernelInputDistributionDecodeResult =
  | {
      subject: 'kernelInputDistribution';
      status: 'ready';
      schemaVersion: 1;
      payload: KernelInputDistribution;
    }
  | Extract<SubjectResult<'kernelInputDistribution'>, { status: 'unavailable' }>
  | Extract<SubjectResult<'kernelInputDistribution'>, { status: 'incompatible' }>;

export function decodeAnalyzerV1KernelInputDistributionPayload(
  input: unknown,
  options: AnalyzerV1PayloadDecodeOptions = {},
): KernelInputDistributionDecodeResult {
  const unsupported = unsupportedV1Payload('kernel-input-distribution', input);
  if (unsupported) return { subject: 'kernelInputDistribution', ...unsupported };
  const parsed = wireSchema.safeParse(input);
  if (!parsed.success) {
    return {
      subject: 'kernelInputDistribution',
      ...incompatiblePayload(
        'kernel-input-distribution',
        wireFormatIssues(input, parsed.error.issues),
        1,
      ),
    };
  }
  const sourceIssue = sourceLogDirIssue(parsed.data.meta.log_dir, options);
  if (sourceIssue) {
    return {
      subject: 'kernelInputDistribution',
      ...incompatiblePayload('kernel-input-distribution', [sourceIssue], 1),
    };
  }
  if (isUnavailable(parsed.data)) {
    return {
      subject: 'kernelInputDistribution',
      status: 'unavailable',
      reason: parsed.data.meta.reason,
    };
  }
  const issues = semanticIssues(parsed.data);
  if (issues.length > 0) {
    return {
      subject: 'kernelInputDistribution',
      ...incompatiblePayload('kernel-input-distribution', issues, 1),
    };
  }
  return {
    subject: 'kernelInputDistribution',
    status: 'ready',
    schemaVersion: 1,
    payload: toDomain(parsed.data),
  };
}
