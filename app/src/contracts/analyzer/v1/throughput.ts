import { z } from 'zod';

import type { Throughput } from '../../../domain/run';
import {
  duplicateKeyIssues,
  nonNegativeNumber,
  parallelLengthIssue,
  positiveCount,
  wireIdentityString,
  type AnalyzerV1PayloadDecodeOptions,
} from './subjectDecode';
import {
  defineAnalyzerV1PayloadDecoder,
  type AnalyzerV1PayloadDecodeResult,
} from './subjectEnvelope';

const seriesSchema = z.object({
  key: wireIdentityString,
  label: z.string().trim().min(1),
  per_gpu: z.array(nonNegativeNumber),
});

const readySchema = z.object({
  schema_version: z.literal(1),
  meta: z.object({
    gpu_name: wireIdentityString,
    log_dir: wireIdentityString,
    num_gpus: positiveCount,
    unit: z.literal('tokens/s per GPU'),
  }),
  t_start_ms: z.array(nonNegativeNumber).min(1),
  t_end_ms: z.array(nonNegativeNumber).min(1),
  series: z.array(seriesSchema).min(3),
});

const unavailableSchema = z.object({
  schema_version: z.literal(1),
  meta: z.object({
    log_dir: wireIdentityString,
    available: z.literal(false),
    reason: z.string().trim().min(1),
  }),
  t_start_ms: z.array(z.unknown()).length(0),
  t_end_ms: z.array(z.unknown()).length(0),
  series: z.array(z.unknown()).length(0),
});

type ReadyWire = z.infer<typeof readySchema>;

export interface ThroughputDecodeOptions extends AnalyzerV1PayloadDecodeOptions {
  expectedGpuName?: string;
  expectedNumGpus?: number;
}

export type ThroughputDecodeResult = AnalyzerV1PayloadDecodeResult<'throughput'>;

const SERIES_KEYS = ['total', 'prefill', 'decode'] as const;

function semanticIssues(wire: ReadyWire, options: ThroughputDecodeOptions): string[] {
  const issues = duplicateKeyIssues('series', wire.series, (series) => series.key);
  const pointCount = wire.t_start_ms.length;
  const endLength = parallelLengthIssue('t_end_ms', pointCount, wire.t_end_ms);
  if (endLength) issues.push(endLength);
  wire.t_start_ms.forEach((start, index) => {
    if (wire.t_end_ms[index] !== undefined && wire.t_end_ms[index] <= start) {
      issues.push(`t_end_ms.${index}: must be greater than t_start_ms.${index}`);
    }
  });
  const byKey = new Map(wire.series.map((series) => [series.key, series]));
  for (const key of SERIES_KEYS) {
    const series = byKey.get(key);
    if (series === undefined) {
      issues.push(`series: missing required ${key} series`);
      continue;
    }
    const lengthIssue = parallelLengthIssue(`series.${key}.per_gpu`, pointCount, series.per_gpu);
    if (lengthIssue) issues.push(lengthIssue);
  }
  const total = byKey.get('total');
  const prefill = byKey.get('prefill');
  const decode = byKey.get('decode');
  if (total && prefill && decode) {
    total.per_gpu.forEach((value, index) => {
      const componentTotal = prefill.per_gpu[index] + decode.per_gpu[index];
      const tolerance = Math.max(1e-9, Math.max(value, componentTotal) * 1e-9);
      if (Math.abs(value - componentTotal) > tolerance) {
        issues.push(`series.total.per_gpu.${index}: must equal prefill + decode`);
      }
    });
  }
  if (options.expectedNumGpus !== undefined && wire.meta.num_gpus !== options.expectedNumGpus) {
    issues.push(`meta.num_gpus: expected ${options.expectedNumGpus}, got ${wire.meta.num_gpus}`);
  }
  if (options.expectedGpuName !== undefined && wire.meta.gpu_name !== options.expectedGpuName) {
    issues.push(`meta.gpu_name: expected ${options.expectedGpuName}, got ${wire.meta.gpu_name}`);
  }
  return issues;
}

function toThroughput(wire: ReadyWire): Throughput {
  const byKey = new Map(wire.series.map((series) => [series.key, series]));
  const clusterRate = (key: (typeof SERIES_KEYS)[number]): number[] =>
    byKey.get(key)!.per_gpu.map((value) => value * wire.meta.num_gpus);
  return {
    t_start_ms: [...wire.t_start_ms],
    t_end_ms: [...wire.t_end_ms],
    total: clusterRate('total'),
    prefill: clusterRate('prefill'),
    decode: clusterRate('decode'),
  };
}

export const decodeAnalyzerV1ThroughputPayload = defineAnalyzerV1PayloadDecoder({
  subject: 'throughput',
  label: 'throughput',
  readySchema,
  unavailableSchema,
  semanticIssues,
  toPayload: toThroughput,
});
