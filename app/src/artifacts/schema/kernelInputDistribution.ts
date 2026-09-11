import { z } from 'zod';

import type { KernelInputDistribution, KernelInputPosition } from '../ref';

export const KERNEL_INPUT_DISTRIBUTION_SCHEMA_VERSION = 1;
const RATIO_TOLERANCE = 1e-6;
const ZERO_TOLERANCE = 1e-12;
const count = z.number().int().nonnegative().safe();
const positiveCount = count.positive();
const finite = z.number().finite();
const nonEmpty = z.string().min(1);

export class IncompatibleKernelInputDistributionError extends Error {
  constructor(
    readonly issues: readonly string[],
    readonly received?: number,
  ) {
    super(
      `kernel-input-distribution payload is not readable:\n${issues
        .map((issue) => `- ${issue}`)
        .join('\n')}`,
    );
    this.name = 'IncompatibleKernelInputDistributionError';
  }
}

export class UnavailableKernelInputDistributionError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'UnavailableKernelInputDistributionError';
  }
}

const selectionSchema = z
  .object({
    backend_index: count.max(254),
    backend_name: nonEmpty,
    count: positiveCount,
    ratio: z.number().finite().min(0).max(1),
  })
  .strict();

const pointSchema = z
  .object({
    x: finite,
    y: finite,
    backend_index: count.max(254),
    backend_name: nonEmpty,
    count: positiveCount,
  })
  .strict();

const positionSchema = z
  .object({
    name: nonEmpty,
    kind: nonEmpty,
    candidate_backends: z.array(nonEmpty).min(1),
    selection: z.array(selectionSchema).min(1),
    projection: z.enum(['categorical', 'feature_1d', 'raw_2d', 'pca']),
    axis_labels: z.tuple([z.string(), z.string()]),
    explained_variance: z
      .tuple([z.number().finite().min(0).max(1), z.number().finite().min(0).max(1)])
      .nullable(),
    points: z.array(pointSchema).min(1),
  })
  .strict();

const definitionsSchema = z
  .object({
    scope: nonEmpty,
    position: nonEmpty,
    backend: nonEmpty,
    point: nonEmpty,
    features: nonEmpty,
    projection: nonEmpty,
    sampling: nonEmpty,
  })
  .strict();

const readySchema = z
  .object({
    schema_version: z.literal(KERNEL_INPUT_DISTRIBUTION_SCHEMA_VERSION),
    available: z.literal(true),
    meta: z
      .object({
        log_dir: nonEmpty,
        sample_stride: positiveCount,
        sampled_rows: positiveCount,
        num_positions_plotted: positiveCount,
        num_positions_multi_backend: count,
        num_positions_manifest: positiveCount,
        num_positions_omitted: count,
        num_positions_without_candidates: count,
        skipped_not_executed_slots: count,
        skipped_empty_input_slots: count,
        max_points_per_position: positiveCount,
      })
      .strict(),
    positions: z.array(positionSchema).min(1),
    definitions: definitionsSchema,
  })
  .strict();

const unavailableSchema = z
  .object({
    schema_version: z.literal(KERNEL_INPUT_DISTRIBUTION_SCHEMA_VERSION),
    meta: z
      .object({
        log_dir: nonEmpty,
        available: z.literal(false),
        reason: nonEmpty,
      })
      .strict(),
    positions: z.array(z.unknown()).length(0),
  })
  .strict();

type ReadyWire = z.infer<typeof readySchema>;

function issuePath(path: PropertyKey[]): string {
  return path.length === 0 ? '<root>' : path.join('.');
}

function structuralIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issuePath(issue.path)}: ${issue.message}`);
}

function duplicateIssues<T>(
  path: string,
  values: readonly T[],
  keyOf: (value: T) => string,
): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    const key = keyOf(value);
    if (seen.has(key)) duplicates.add(key);
    seen.add(key);
  }
  return [...duplicates].map((key) => `${path}: duplicate key ${JSON.stringify(key)}`);
}

function projectionIssues(position: ReadyWire['positions'][number], path: string): string[] {
  const issues: string[] = [];
  const [xLabel, yLabel] = position.axis_labels;
  if (position.projection === 'categorical') {
    if (xLabel.length === 0 || yLabel !== '') {
      issues.push(`${path}.axis_labels: categorical projection requires one display label`);
    }
    if (position.explained_variance !== null) {
      issues.push(`${path}.explained_variance: must be null for categorical projection`);
    }
    if (
      position.points.some(
        (point) => Math.abs(point.x) > ZERO_TOLERANCE || Math.abs(point.y) > ZERO_TOLERANCE,
      )
    ) {
      issues.push(`${path}.points: categorical coordinates must be zero placeholders`);
    }
  } else if (position.projection === 'feature_1d') {
    if (xLabel.length === 0 || yLabel !== '') {
      issues.push(`${path}.axis_labels: feature_1d requires one value-axis label`);
    }
    if (position.explained_variance !== null) {
      issues.push(`${path}.explained_variance: must be null for feature_1d projection`);
    }
    if (position.points.some((point) => Math.abs(point.y) > ZERO_TOLERANCE)) {
      issues.push(`${path}.points: feature_1d y coordinates must be zero`);
    }
  } else if (position.projection === 'raw_2d') {
    if (xLabel.length === 0 || yLabel.length === 0) {
      issues.push(`${path}.axis_labels: raw_2d requires two value-axis labels`);
    }
    if (position.explained_variance !== null) {
      issues.push(`${path}.explained_variance: must be null for raw_2d projection`);
    }
  } else {
    if (xLabel !== 'PC1' || yLabel !== 'PC2') {
      issues.push(`${path}.axis_labels: pca projection requires PC1 and PC2`);
    }
    if (position.explained_variance === null) {
      issues.push(`${path}.explained_variance: required for pca projection`);
    } else if (
      position.explained_variance[0] + position.explained_variance[1] >
      1 + ZERO_TOLERANCE
    ) {
      issues.push(`${path}.explained_variance: variance ratios must sum to at most 1`);
    }
  }
  return issues;
}

function positionIssues(position: ReadyWire['positions'][number], index: number): string[] {
  const path = `positions.${index}`;
  const issues = duplicateIssues(`${path}.selection`, position.selection, (selection) =>
    String(selection.backend_index),
  );
  const selections = new Map(
    position.selection.map((selection) => [selection.backend_index, selection]),
  );
  const selectionTotal = position.selection.reduce((sum, selection) => sum + selection.count, 0);
  const pointTotal = position.points.reduce((sum, point) => sum + point.count, 0);
  if (selectionTotal !== pointTotal) {
    issues.push(
      `${path}.points: weighted count ${pointTotal} does not equal selection total ${selectionTotal}`,
    );
  }
  const ratioTotal = position.selection.reduce((sum, selection) => sum + selection.ratio, 0);
  if (Math.abs(ratioTotal - 1) > RATIO_TOLERANCE) {
    issues.push(`${path}.selection: ratios sum to ${ratioTotal}, expected 1`);
  }
  position.selection.forEach((selection, selectionIndex) => {
    const expectedName =
      position.candidate_backends[selection.backend_index] ??
      `candidate_${selection.backend_index}`;
    if (selection.backend_name !== expectedName) {
      issues.push(
        `${path}.selection.${selectionIndex}.backend_name: expected ${JSON.stringify(expectedName)}`,
      );
    }
    const represented = position.points
      .filter((point) => point.backend_index === selection.backend_index)
      .reduce((sum, point) => sum + point.count, 0);
    if (represented !== selection.count) {
      issues.push(
        `${path}.selection.${selectionIndex}.count: ${selection.count} disagrees with point count ${represented}`,
      );
    }
    const expectedRatio = selection.count / selectionTotal;
    if (Math.abs(selection.ratio - expectedRatio) > RATIO_TOLERANCE) {
      issues.push(
        `${path}.selection.${selectionIndex}.ratio: ${selection.ratio} disagrees with count ratio ${expectedRatio}`,
      );
    }
  });
  position.points.forEach((point, pointIndex) => {
    const selection = selections.get(point.backend_index);
    if (selection === undefined) {
      issues.push(`${path}.points.${pointIndex}.backend_index: missing from selection`);
    } else if (point.backend_name !== selection.backend_name) {
      issues.push(`${path}.points.${pointIndex}.backend_name: disagrees with selection`);
    }
  });
  issues.push(...projectionIssues(position, path));
  return issues;
}

function semanticIssues(wire: ReadyWire): string[] {
  const issues = duplicateIssues('positions', wire.positions, (position) => position.name);
  if (wire.positions.length !== wire.meta.num_positions_plotted) {
    issues.push(
      `meta.num_positions_plotted: expected ${wire.positions.length}, got ${wire.meta.num_positions_plotted}`,
    );
  }
  const multiBackend = wire.positions.filter((position) => position.selection.length > 1).length;
  if (multiBackend !== wire.meta.num_positions_multi_backend) {
    issues.push(
      `meta.num_positions_multi_backend: expected ${multiBackend}, got ${wire.meta.num_positions_multi_backend}`,
    );
  }
  if (
    wire.meta.num_positions_manifest - wire.meta.num_positions_plotted !==
    wire.meta.num_positions_omitted
  ) {
    issues.push(
      'meta.num_positions_omitted: must equal manifest positions minus plotted positions',
    );
  }
  if (wire.meta.num_positions_without_candidates > wire.meta.num_positions_omitted) {
    issues.push('meta.num_positions_without_candidates: cannot exceed omitted positions');
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
    candidateBackends: position.candidate_backends,
    selection: position.selection.map((selection) => ({
      backendIndex: selection.backend_index,
      backendName: selection.backend_name,
      count: selection.count,
      ratio: selection.ratio,
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

export function parseKernelInputDistribution(body: unknown): KernelInputDistribution {
  const unavailable = unavailableSchema.safeParse(body);
  if (unavailable.success) {
    throw new UnavailableKernelInputDistributionError(unavailable.data.meta.reason);
  }
  const received = (body as { schema_version?: unknown } | null)?.schema_version;
  const parsed = readySchema.safeParse(body);
  if (!parsed.success) {
    throw new IncompatibleKernelInputDistributionError(
      structuralIssues(parsed.error),
      typeof received === 'number' ? received : undefined,
    );
  }
  const wire = parsed.data;
  const issues = semanticIssues(wire);
  if (issues.length > 0) {
    throw new IncompatibleKernelInputDistributionError(issues, wire.schema_version);
  }
  return {
    positions: wire.positions.map(toPosition),
    sourceLogDir: wire.meta.log_dir,
    sampling: {
      stride: wire.meta.sample_stride,
      sampledRows: wire.meta.sampled_rows,
      skippedNotExecutedSlots: wire.meta.skipped_not_executed_slots,
      skippedEmptyInputSlots: wire.meta.skipped_empty_input_slots,
      maxPointsPerPosition: wire.meta.max_points_per_position,
    },
    positionCounts: {
      plotted: wire.meta.num_positions_plotted,
      multiBackend: wire.meta.num_positions_multi_backend,
      manifest: wire.meta.num_positions_manifest,
      omitted: wire.meta.num_positions_omitted,
      withoutCandidates: wire.meta.num_positions_without_candidates,
    },
    definitions: wire.definitions,
  };
}
