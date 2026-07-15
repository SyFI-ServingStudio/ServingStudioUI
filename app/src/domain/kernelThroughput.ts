/** Exact distribution summary over analyzer-sampled cost slots. `null` values
 * are meaningful only when sampleCount is zero. */
export interface KernelRateStats {
  sampleCount: number;
  mean: number | null;
  p50: number | null;
  p90: number | null;
  p99: number | null;
  max: number | null;
}

/** A manifest leaf name is the stable location identity. Several workers and
 * parallel Max branches may intentionally contribute to the same location. */
export interface KernelThroughputLocation {
  name: string;
  kind: string;
  tflops: KernelRateStats;
  gbps: KernelRateStats;
}

export interface KernelThroughput {
  locations: readonly KernelThroughputLocation[];
  sampling: {
    stride: number;
    sampledRows: number;
    sampledComputeSlots: number;
    sampledMemorySlots: number;
  };
  units: {
    tflops: 'TFLOP/s';
    gbps: 'GB/s';
  };
  definitions: Readonly<Record<string, string>>;
}
