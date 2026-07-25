import { z } from 'zod';

import type { Slo, SloMetric } from '../../../domain/run';
import {
  duplicateKeyIssues,
  finiteNumber,
  nonDecreasingIssue,
  nonNegativeCount,
  nonNegativeNumber,
  parallelLengthIssue,
  wireIdentityString,
  type AnalyzerV1PayloadDecodeOptions,
} from './subjectDecode';
import {
  defineAnalyzerV1PayloadDecoder,
  type AnalyzerV1PayloadDecodeResult,
} from './subjectEnvelope';

const markersSchema = z.object({
  p50: nonNegativeNumber,
  p90: nonNegativeNumber,
  p99: nonNegativeNumber,
});

const seriesSchema = z.object({
  key: wireIdentityString,
  label: z.string().trim().min(1),
  markers: markersSchema,
  n: nonNegativeCount,
  unit: z.string().trim().min(1),
  x: z.array(nonNegativeNumber),
  y_pct: z.array(finiteNumber),
});

const readySchema = z.object({
  schema_version: z.literal(1),
  meta: z.object({ log_dir: wireIdentityString }),
  series: z.array(seriesSchema).min(3),
});

const unavailableSchema = z.object({
  schema_version: z.literal(1),
  meta: z.object({
    log_dir: wireIdentityString,
    available: z.literal(false),
    reason: z.string().trim().min(1),
  }),
  series: z.array(z.unknown()).length(0),
});

type ReadyWire = z.infer<typeof readySchema>;
type SeriesWire = z.infer<typeof seriesSchema>;

export interface SloDecodeOptions extends AnalyzerV1PayloadDecodeOptions {
  expectedCompletedRequests?: number;
}

export type SloDecodeResult = AnalyzerV1PayloadDecodeResult<'slo'>;

const EXPECTED_UNITS = { ttft: 'ms', tpot: 'ms/token', e2e: 'ms' } as const;

function semanticIssues(wire: ReadyWire, options: SloDecodeOptions): string[] {
  const issues = duplicateKeyIssues('series', wire.series, (series) => series.key);
  const byKey = new Map(wire.series.map((series) => [series.key, series]));
  for (const [key, unit] of Object.entries(EXPECTED_UNITS)) {
    const series = byKey.get(key);
    if (series === undefined) {
      issues.push(`series: missing required ${key} series`);
      continue;
    }
    if (series.unit !== unit)
      issues.push(`series.${key}.unit: expected ${unit}, got ${series.unit}`);
  }
  wire.series.forEach((series, index) => {
    const yLength = parallelLengthIssue(`series.${index}.y_pct`, series.x.length, series.y_pct);
    if (yLength) issues.push(yLength);
    const xOrder = nonDecreasingIssue(`series.${index}.x`, series.x);
    if (xOrder) issues.push(xOrder);
    const yOrder = nonDecreasingIssue(`series.${index}.y_pct`, series.y_pct);
    if (yOrder) issues.push(yOrder);
    series.y_pct.forEach((value, pointIndex) => {
      if (value < 0 || value > 100) {
        issues.push(`series.${index}.y_pct.${pointIndex}: must be in the 0-100 percent range`);
      }
    });
    if (series.markers.p50 > series.markers.p90 || series.markers.p90 > series.markers.p99) {
      issues.push(`series.${index}.markers: percentiles must be non-decreasing`);
    }
    if (
      options.expectedCompletedRequests !== undefined &&
      series.n !== options.expectedCompletedRequests
    ) {
      issues.push(
        `series.${index}.n: expected ${options.expectedCompletedRequests}, got ${series.n}`,
      );
    }
  });
  return issues;
}

function toMetric(series: SeriesWire): SloMetric {
  return {
    label: series.label,
    unit: series.unit,
    x: [...series.x],
    y_pct: [...series.y_pct],
    markers: { ...series.markers },
  };
}

function toSlo(wire: ReadyWire): Slo {
  const byKey = new Map(wire.series.map((series) => [series.key, series]));
  return {
    ttft: toMetric(byKey.get('ttft')!),
    tpot: toMetric(byKey.get('tpot')!),
    e2e: toMetric(byKey.get('e2e')!),
  };
}

export const decodeAnalyzerV1SloPayload = defineAnalyzerV1PayloadDecoder({
  subject: 'slo',
  label: 'slo-general',
  readySchema,
  unavailableSchema,
  semanticIssues,
  toPayload: toSlo,
});
