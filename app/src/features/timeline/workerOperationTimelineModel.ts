import type { OperationSummary } from '../../domain/workerOperation';

export const OPERATION_DRAG_THRESHOLD_PX = 8;
export const OPERATION_TRACK_HEIGHT_PX = 96;

const OPERATION_COLORS = [
  '#356f69',
  '#5f7180',
  '#71806a',
  '#8a715c',
  '#86635f',
  '#756b7b',
] as const;

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** Slot/batch colors are derived from identity, not page order, so navigation
 * never silently changes the visual meaning of an operation. */
export function operationLaneColor(laneIdentity: string): string {
  const numericIdentity = /^(0|[1-9]\d*)$/.test(laneIdentity) ? Number(laneIdentity) : Number.NaN;
  const paletteIndex = Number.isSafeInteger(numericIdentity)
    ? numericIdentity % OPERATION_COLORS.length
    : stableHash(laneIdentity) % OPERATION_COLORS.length;
  return OPERATION_COLORS[paletteIndex];
}

export interface TimelineOperationEntry {
  readonly key: string;
  readonly operation: OperationSummary;
}

export interface OperationBarGeometry {
  readonly cellX: number;
  readonly cellWidth: number;
  readonly barX: number;
  readonly barY: number;
  readonly barWidth: number;
  readonly barHeight: number;
}

/** A robust upper bound prevents one long operation from flattening every
 * ordinary bar while still following sustained workload-regime changes. */
export function operationDurationScaleMs(
  operations: readonly OperationSummary[],
  percentile = 0.95,
): number {
  if (operations.length === 0) return 1;
  const durations = operations
    .map((operation) => operation.endMs - operation.startMs)
    .filter((duration) => Number.isFinite(duration) && duration > 0)
    .sort((left, right) => left - right);
  if (durations.length === 0) return 1;
  const boundedPercentile = Math.min(1, Math.max(0, percentile));
  const rank = Math.max(0, Math.ceil(durations.length * boundedPercentile) - 1);
  return durations[rank] ?? 1;
}

export function operationMaximumDurationMs(operations: readonly OperationSummary[]): number {
  const durations = operations
    .map((operation) => operation.endMs - operation.startMs)
    .filter((duration) => Number.isFinite(duration) && duration > 0);
  return durations.length === 0 ? 1 : Math.max(...durations);
}

/** Keeps ordinal spacing stable while duration controls only the bar height.
 * The bounded gap follows the old separated-column treatment without wasting
 * most of a dense 64-operation viewport. */
export function operationBarGeometry(
  index: number,
  operationCount: number,
  trackWidth: number,
  durationMs: number,
  maximumDurationMs: number,
  pixelRatio: number,
  trackHeight = OPERATION_TRACK_HEIGHT_PX,
  dragDeltaX = 0,
  isMaximumDuration = true,
): OperationBarGeometry {
  const cellWidth = trackWidth / Math.max(1, operationCount);
  const cellX = index * cellWidth + dragDeltaX;
  const gapWidth = Math.min(3, Math.max(1 / pixelRatio, cellWidth * 0.16));
  const barWidth = Math.max(1 / pixelRatio, cellWidth - gapWidth);
  const normalizedDuration = durationMs / Math.max(Number.EPSILON, maximumDurationMs);
  const maximumBarHeight = Math.max(7, trackHeight - 10);
  const availableBarHeight = maximumBarHeight * (isMaximumDuration ? 1 : 0.8);
  const barHeight = Math.max(
    7,
    Math.min(availableBarHeight, normalizedDuration * availableBarHeight),
  );
  return {
    cellX,
    cellWidth,
    barX: cellX + (cellWidth - barWidth) / 2,
    barY: trackHeight - 5 - barHeight,
    barWidth,
    barHeight,
  };
}

/** Maps one pointer coordinate to the operation's equal-width ordinal cell.
 * Timing remains operation data, but the selector deliberately avoids encoding
 * duration in bar width so short operations remain individually targetable. */
export function hitTestOperation(
  entries: readonly TimelineOperationEntry[],
  pointerX: number,
  trackWidth: number,
): TimelineOperationEntry | null {
  if (entries.length === 0 || trackWidth <= 0) return null;
  const boundedX = Math.min(trackWidth - Number.EPSILON, Math.max(0, pointerX));
  const index = Math.min(entries.length - 1, Math.floor((boundedX / trackWidth) * entries.length));
  return entries[index] ?? null;
}
