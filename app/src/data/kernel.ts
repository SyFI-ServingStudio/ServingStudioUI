/*
 * kernel.ts — per-leaf derived kernel analytics (kernel scope + worker scope).
 * Mirrors the analyzer's `kernel_throughput_locations` (achieved TFLOP/s & GB/s
 * vs the H200 roofline) and `kernel_input_distribution_scatter` (which backend
 * the cost model selects across the input feature space). Deterministic by the
 * leaf's cost-tree id so a backend can swap these for real sampled values later.
 */
import { groupOf, type LeafNode } from './tree';

// H200 SXM peak — bf16 dense tensor throughput + HBM3e bandwidth
export const H200_PEAK = { tflops: 989, gbps: 4800 };

// integer hash → [0,1); stable, no Date/Math.random
function hsh(n: number): number {
  let x = Math.imul(n, 2654435761) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  return (x >>> 0) / 4294967296;
}

export interface KernelPerf {
  tflops: number;
  gbps: number;
  peakTflops: number;
  peakGbps: number;
  computeUtil: number;
  memUtil: number;
  boundedBy: 'compute' | 'memory';
  intensity: number; // FLOP / byte
}

/** Achieved compute/bandwidth for a leaf, characterised by its kernel family. */
export function kernelPerf(node: LeafNode): KernelPerf {
  const g = groupOf(node.slot.kind);
  const r = hsh(node.id + 7);
  let tf = 0,
    bw = 0;
  if (g === 'gemm') {
    tf = H200_PEAK.tflops * (0.55 + 0.16 * r);
    bw = H200_PEAK.gbps * (0.22 + 0.1 * r);
  } else if (g === 'attn') {
    tf = H200_PEAK.tflops * (0.3 + 0.15 * r);
    bw = H200_PEAK.gbps * (0.34 + 0.16 * r);
  } else if (g === 'comm') {
    tf = H200_PEAK.tflops * (0.005 + 0.01 * r);
    bw = H200_PEAK.gbps * (0.55 + 0.22 * r);
  } else if (g === 'route') {
    tf = H200_PEAK.tflops * (0.04 + 0.05 * r);
    bw = H200_PEAK.gbps * (0.28 + 0.16 * r);
  } else {
    tf = H200_PEAK.tflops * (0.02 + 0.02 * r);
    bw = H200_PEAK.gbps * (0.42 + 0.22 * r);
  } // norm / elementwise
  const computeUtil = tf / H200_PEAK.tflops;
  const memUtil = bw / H200_PEAK.gbps;
  const intensity = (tf * 1e12) / (bw * 1e9); // FLOP per byte
  return {
    tflops: +tf.toFixed(1),
    gbps: +bw.toFixed(0),
    peakTflops: H200_PEAK.tflops,
    peakGbps: H200_PEAK.gbps,
    computeUtil: +computeUtil.toFixed(3),
    memUtil: +memUtil.toFixed(3),
    boundedBy: computeUtil >= memUtil ? 'compute' : 'memory',
    intensity: +intensity.toFixed(2),
  };
}

/** Candidate backends the selector chooses among, keyed by kernel kind. */
export function candidateBackends(kind: string): string[] {
  if (kind.startsWith('flashinfer_attn')) return ['fa2', 'fa3'];
  if (kind === 'single_gemm' || kind === 'grouped_gemm') return ['cutlass', 'triton'];
  if (kind === 'all_reduce' || kind.startsWith('p2p')) return ['nccl'];
  return ['default'];
}

export interface DistPoint {
  x: number;
  y: number;
  backend: number;
  count: number;
}
export interface InputDist {
  backends: string[];
  feature: [string, string];
  projection: 'raw' | 'pca';
  points: DistPoint[];
}

/** Sampled calls over a 2-feature input space, colored by selected backend. */
export function inputDist(node: LeafNode): InputDist {
  const kind = node.slot.kind;
  const backends = candidateBackends(kind);
  const attn = kind.includes('attn');
  const feature: [string, string] = attn
    ? ['seq_len (norm)', 'batch_size (norm)']
    : ['M · tokens (norm)', 'K · reduce (norm)'];
  const pts: DistPoint[] = [];
  const N = 150;
  for (let i = 0; i < N; i++) {
    const x = hsh(node.id * 131 + i * 7);
    const y = hsh(node.id * 977 + i * 13);
    let b = 0;
    if (backends.length > 1) {
      // a wavy decision boundary: larger inputs favour the second backend (e.g. fa3 for long seq)
      const boundary = 0.46 + 0.12 * Math.sin(y * 6.0);
      b = x > boundary ? 1 : 0;
      if (Math.abs(x - boundary) < 0.06 && hsh(i * 31 + node.id) < 0.32) b = 1 - b; // fuzzy border
    }
    pts.push({
      x: +x.toFixed(3),
      y: +y.toFixed(3),
      backend: b,
      count: 1 + Math.floor(hsh(i + node.id * 3) * 40),
    });
  }
  return { backends, feature, projection: 'raw', points: pts };
}
