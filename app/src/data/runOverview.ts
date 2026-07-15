import type { Run } from './fakeData';

export interface TraceOverviewData {
  tokenLengths: number[];
  inputDensity: number[];
  outputDensity: number[];
  arrivalSeconds: number[];
  arrivals: number[];
  arrivalTrend: number[];
  peakToMean: number;
}

function strHash(value: string): number {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function logNormalDensity(tokens: number, median: number, sigma: number): number {
  const z = Math.log(tokens / median) / sigma;
  return Math.exp(-0.5 * z * z) / (tokens * sigma);
}

function normalizedDensity(tokens: number[], median: number, sigma: number): number[] {
  const density = tokens.map((value) => logNormalDensity(value, median, sigma));
  const peak = Math.max(...density);
  return density.map((value) => +(value / peak).toFixed(4));
}

function movingAverage(values: number[], radius = 2): number[] {
  return values.map((_, index) => {
    const start = Math.max(0, index - radius);
    const end = Math.min(values.length, index + radius + 1);
    const window = values.slice(start, end);
    return +(window.reduce((sum, value) => sum + value, 0) / window.length).toFixed(2);
  });
}

/** Deterministic fake workload evidence. Keeping this separate from component
 *  layout makes the eventual payload handoff a one-file replacement. */
export function traceOverviewFor(run: Run): TraceOverviewData {
  const random = rng(strHash(run.id) ^ 0xa511e9b3);
  const tokenLengths = Array.from({ length: 72 }, (_, index) => Math.round(4 * Math.pow(8192, index / 71)));
  const moeScale = run.summary.num_gpus > 1 ? 1.35 : 1;
  const inputDensity = normalizedDensity(tokenLengths, 850 * moeScale, 1.02);
  const outputDensity = normalizedDensity(tokenLengths, 180 * moeScale, 0.82);

  const bucketCount = 72;
  const traceEndMs = run.payloads.throughput.t_end_ms[run.payloads.throughput.t_end_ms.length - 1] ?? 1;
  const burstCenters = [0.18 + random() * 0.05, 0.52 + random() * 0.06, 0.8 + random() * 0.04];
  const raw = Array.from({ length: bucketCount }, (_, index) => {
    const x = (index + 0.5) / bucketCount;
    const bursts = burstCenters.reduce((sum, center, burstIndex) => {
      const width = 0.018 + burstIndex * 0.012;
      const amplitude = 2.2 - burstIndex * 0.35;
      return sum + amplitude * Math.exp(-0.5 * Math.pow((x - center) / width, 2));
    }, 0);
    return 0.42 + 0.15 * Math.sin(x * Math.PI * 6) + bursts + random() * 0.34;
  });
  const rawTotal = raw.reduce((sum, value) => sum + value, 0);
  const exact = raw.map((value) => (value / rawTotal) * run.summary.requests);
  const arrivals = exact.map(Math.floor);
  const unassigned = run.summary.requests - arrivals.reduce((sum, value) => sum + value, 0);
  const remainderOrder = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (let index = 0; index < unassigned; index += 1) arrivals[remainderOrder[index].index] += 1;

  const mean = run.summary.requests / bucketCount;
  return {
    tokenLengths,
    inputDensity,
    outputDensity,
    arrivalSeconds: Array.from({ length: bucketCount }, (_, index) => +(((index + 0.5) / bucketCount) * traceEndMs / 1000).toFixed(2)),
    arrivals,
    arrivalTrend: movingAverage(arrivals),
    peakToMean: +(Math.max(...arrivals) / mean).toFixed(1),
  };
}
