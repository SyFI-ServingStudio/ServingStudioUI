export interface TraceOverviewData {
  requestRate: number;
  tokenLengths: readonly number[];
  inputDensity: readonly number[];
  outputDensity: readonly number[];
  arrivalSeconds: readonly number[];
  arrivals: readonly number[];
  arrivalTrend: readonly number[];
  peakToMean: number;
}
