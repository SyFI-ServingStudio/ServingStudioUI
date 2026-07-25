// Public entry for the shared metric-chart layer: every stage (cluster, pool,
// worker) resolves a subject into a chart view through here. Subject-specific
// analysis that only one stage renders belongs in that stage's feature instead
// — see features/optimality for the optimality ladder cards.
export { default as KernelTimeBreakdownCard } from './KernelTimeBreakdownCard';
export {
  projectKernelTimeBreakdown,
  type KernelTimeBreakdownProjection,
  type ReadyKernelTimeBreakdown,
} from './kernelTimeBreakdown';
export { default as SloChartRow } from './SloChartRow';
export { batchMetricOption, poolBatchMetricOption } from './options';
export { METRIC_CAPTIONS, METRIC_TITLES, metricView } from './metricView';
