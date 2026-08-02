import type { AnalyzerSelectionV2 } from '../../domain/analyzerSelection';
import {
  analyzerTurnContextV2Schema,
  citationDictionarySnapshotV2Schema,
  type AnalyzerTurnContextV2,
  type CitationDictionaryEntryV2,
  type CitationDictionarySnapshotV2,
} from '../../domain/citation';
import type {
  SweepAnalysis,
  SweepCoordinateValue,
  SweepMetric,
  SweepPrimitive,
  SweepRun,
} from '../../domain/sweep';
import { metricStatisticLabel, sweepMetricSections } from '../sweep/metricSections';

const AXIS_ALIASES: Readonly<Record<string, string>> = {
  tensor_parallel: 'tp',
  tp: 'tp',
  request_rate: 'rate',
  rate: 'rate',
};
const MAX_ENTRIES = 1_800;

function safeSegment(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '');
  return /^[a-z]/.test(normalized) ? normalized : `v${normalized || 'unknown'}`;
}

function compactValue(value: SweepCoordinateValue): string {
  if (Array.isArray(value)) return value.map(compactValue).join('_');
  if (value === null) return 'null';
  if (typeof value === 'number') {
    return String(value).replace('-', 'm').replace('.', 'p');
  }
  return safeSegment(String(value));
}

function coordinateIdentity(value: SweepCoordinateValue): string {
  return JSON.stringify(value);
}

function shortIdentity(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function axisAlias(axis: string, used: Set<string>): string {
  const preferred = AXIS_ALIASES[axis] ?? safeSegment(axis);
  let alias = preferred;
  let suffix = 2;
  while (used.has(alias)) {
    alias = `${preferred}${suffix}`;
    suffix += 1;
  }
  used.add(alias);
  return alias;
}

interface AxisDictionary {
  axis: string;
  alias: string;
  values: Map<string, { segment: string; value: SweepCoordinateValue }>;
}

function buildAxisDictionaries(analysis: SweepAnalysis): readonly AxisDictionary[] {
  const usedAliases = new Set<string>();
  return analysis.axes.map((axis) => {
    const alias = axisAlias(axis, usedAliases);
    const actualValues = new Map<string, SweepCoordinateValue>();
    analysis.runs.forEach((run) => {
      const value = run.coordinates[axis];
      if (value !== undefined) actualValues.set(coordinateIdentity(value), value);
    });
    const usedSegments = new Map<string, string>();
    const values = new Map<string, { segment: string; value: SweepCoordinateValue }>();
    actualValues.forEach((value, identity) => {
      const base = `${alias}${compactValue(value)}`;
      const existingIdentity = usedSegments.get(base);
      const segment =
        existingIdentity === undefined || existingIdentity === identity
          ? base
          : `${base}_${shortIdentity(identity)}`;
      usedSegments.set(segment, identity);
      values.set(identity, { segment, value });
    });
    return { axis, alias, values };
  });
}

function metricPath(metric: SweepMetric): string {
  const statistic = metricStatisticLabel(metric)?.toLowerCase();
  if (metric.key === 'total_tps') return 'throughput';
  if (metric.group === 'tpot' || metric.key.includes('tpot')) {
    return statistic ? `tpot.${statistic}` : 'tpot';
  }
  if (metric.group === 'ttft' || metric.key.includes('ttft')) {
    return statistic ? `ttft.${statistic}` : 'ttft';
  }
  if (metric.group === 'utilization' || metric.key.includes('utilization')) return 'utilization';
  return safeSegment(metric.key);
}

function panelForMetric(analysis: SweepAnalysis, metric: SweepMetric): string {
  const panels = sweepMetricSections(analysis.metrics).flatMap((section) => section.panels);
  return (
    panels.find((panel) => panel.metrics.some((candidate) => candidate.key === metric.key))?.id ??
    metric.key
  );
}

function memberPrefix(run: SweepRun, axes: readonly AxisDictionary[]): string | null {
  const segments: string[] = [];
  for (const axis of axes) {
    const value = run.coordinates[axis.axis];
    if (value === undefined) return null;
    const dictionaryValue = axis.values.get(coordinateIdentity(value));
    if (!dictionaryValue) return null;
    segments.push(dictionaryValue.segment);
  }
  return segments.join('.');
}

function aggregateDictionary(analysis: SweepAnalysis): CitationDictionarySnapshotV2 {
  const axes = buildAxisDictionaries(analysis);
  const entries: CitationDictionaryEntryV2[] = [];
  const metrics = analysis.metrics.map((metric) => ({
    metric,
    path: metricPath(metric),
    panelId: panelForMetric(analysis, metric),
  }));
  const uniqueMetrics = metrics.filter(
    (candidate, index) => metrics.findIndex((metric) => metric.path === candidate.path) === index,
  );

  uniqueMetrics.forEach(({ metric, path, panelId }) => {
    entries.push({
      token: `exp.${path}`,
      displayLabel: `${metric.label} · all coordinates`,
      target: {
        protocol: 'vibesim.analyzer/v2',
        kind: 'aggregate',
        workspaceId: analysis.workspaceId,
        experimentId: analysis.sweepId,
        panelId,
        metricKey: metric.key,
        ...(metricStatisticLabel(metric)
          ? { statistic: metricStatisticLabel(metric)?.toLowerCase() as 'mean' | 'p99' }
          : {}),
      },
    });
  });

  const memberRows: string[] = [];
  analysis.runs.forEach((run) => {
    if (!run.runId) return;
    const runId = run.runId;
    const prefix = memberPrefix(run, axes);
    if (!prefix) return;
    memberRows.push(prefix);
    uniqueMetrics.forEach(({ metric, path, panelId }) => {
      if (entries.length >= MAX_ENTRIES) return;
      const coordinates = Object.fromEntries(
        analysis.axes.map((axis) => {
          const value = run.coordinates[axis];
          return [
            axis,
            Array.isArray(value)
              ? Array.from(value as readonly SweepPrimitive[])
              : (value as SweepPrimitive),
          ];
        }),
      );
      const coordinateLabel = analysis.axes
        .map((axis) => run.labels[axis] ?? `${axis}=${String(run.coordinates[axis])}`)
        .join(' · ');
      entries.push({
        token: `exp.${prefix}.${path}`,
        displayLabel: `${coordinateLabel} · ${metric.label}`,
        target: {
          protocol: 'vibesim.analyzer/v2',
          kind: 'aggregate',
          workspaceId: analysis.workspaceId,
          experimentId: analysis.sweepId,
          panelId,
          metricKey: metric.key,
          ...(metricStatisticLabel(metric)
            ? { statistic: metricStatisticLabel(metric)?.toLowerCase() as 'mean' | 'p99' }
            : {}),
          runId,
          coordinates,
        },
      });
    });
  });

  const axisRows = axes.map((axis) => {
    const segments = Array.from(axis.values.values(), (entry) => `\`${entry.segment}\``).join(', ');
    return `  - \`${axis.alias}<value>\`: ${axis.axis}; valid segments: ${segments}`;
  });
  const metricRows = uniqueMetrics.map(
    ({ metric, path }) => `  - \`${path}\`: ${metric.label}, ${metric.unit}`,
  );
  const document = [
    '## Analyzer citation references',
    '',
    'Use only these exact Markdown inline-code references. Citation text never navigates until the user clicks it.',
    '',
    'Experiment `exp`',
    '- axes, in launcher declaration order:',
    ...(axisRows.length ? axisRows : ['  - none (single configuration)']),
    '- valid members:',
    ...memberRows.map((member) => `  - \`${member}\``),
    '- metrics:',
    ...metricRows,
    '- forms: `exp.<metric>` and `exp.<member>.<metric>`',
  ].join('\n');
  const identitySource = entries
    .map(
      (entry) =>
        `${entry.token}:${entry.target.kind === 'aggregate' ? (entry.target.runId ?? '') : ''}`,
    )
    .join('|');
  return citationDictionarySnapshotV2Schema.parse({
    protocol: 'vibesim.citation-dictionary/v2',
    identity: `aggregate-${shortIdentity(`${analysis.sweepId}|${identitySource}`)}`,
    document,
    entries,
  });
}

interface RunPanelDescriptor {
  token: string;
  panelId: string;
  label: string;
  scopes: readonly Extract<AnalyzerSelectionV2, { kind: 'run' }>['scope'][];
}

const RUN_PANELS: readonly RunPanelDescriptor[] = [
  { token: 'throughput', panelId: 'throughput', label: 'Throughput', scopes: ['cluster'] },
  {
    token: 'utilization',
    panelId: 'utilization',
    label: 'GPU utilization',
    scopes: ['cluster', 'pool', 'worker'],
  },
  {
    token: 'request-state',
    panelId: 'request-state',
    label: 'Request state',
    scopes: ['cluster', 'pool', 'worker'],
  },
  {
    token: 'kv-cache',
    panelId: 'kv-cache',
    label: 'KV cache occupancy',
    scopes: ['pool', 'worker'],
  },
  {
    token: 'kernel-time',
    panelId: 'kernel-time-breakdown',
    label: 'Kernel time breakdown',
    scopes: ['worker', 'kernel', 'parallel'],
  },
  {
    token: 'optimality',
    panelId: 'optimality-breakdown',
    label: 'Optimality breakdown',
    scopes: ['cluster', 'pool', 'worker', 'kernel', 'parallel'],
  },
];

function runDictionary(
  selection: Extract<AnalyzerSelectionV2, { kind: 'run' }>,
): CitationDictionarySnapshotV2 {
  const descriptors = [
    ...RUN_PANELS.filter((descriptor) => descriptor.scopes.includes(selection.scope)),
    ...(selection.panelId &&
    !RUN_PANELS.some((descriptor) => descriptor.panelId === selection.panelId)
      ? [
          {
            token: `selected.${safeSegment(selection.panelId)}`,
            panelId: selection.panelId,
            label: `Selected panel · ${selection.panelId}`,
            scopes: [selection.scope],
          },
        ]
      : []),
  ];
  const entries = descriptors.map<CitationDictionaryEntryV2>((descriptor) => ({
    token: `run.${selection.scope}.${descriptor.token}`,
    displayLabel: descriptor.label,
    target: {
      protocol: 'vibesim.analyzer/v2',
      ...selection,
      panelId: descriptor.panelId,
    },
  }));
  const document = [
    '## Analyzer citation references',
    '',
    'Use only these exact Markdown inline-code references. Citation text never navigates until the user clicks it.',
    '',
    'Current run `run`',
    ...entries.map((entry) => `- \`${entry.token}\`: ${entry.displayLabel}`),
  ].join('\n');
  return citationDictionarySnapshotV2Schema.parse({
    protocol: 'vibesim.citation-dictionary/v2',
    identity: `run-${shortIdentity(`${selection.runId}|${JSON.stringify(selection)}|${entries.map((entry) => entry.token).join('|')}`)}`,
    document,
    entries,
  });
}

function predictionDictionary(
  selection: Extract<AnalyzerSelectionV2, { kind: 'prediction' }>,
): CitationDictionarySnapshotV2 {
  const panel = selection.panelId ?? 'overview';
  const segments = [
    'pred',
    ...(selection.caseId ? [`case${compactValue(selection.caseId)}`] : []),
    ...(selection.operationId ? [`operation${compactValue(selection.operationId)}`] : []),
    ...(selection.leafId !== null ? [`kernel${selection.leafId}`] : []),
    ...(selection.parallelId !== null ? [`parallel${selection.parallelId}`] : []),
    ...(selection.optimalityMode === 'batch_locked' ? ['batch_locked'] : []),
    safeSegment(panel),
  ];
  const token = segments.join('.');
  const labels = [
    `prediction ${selection.predictionId}`,
    ...(selection.caseId ? [`case ${selection.caseId}`] : []),
    ...(selection.operationId ? [`operation ${selection.operationId}`] : []),
    ...(selection.leafId !== null ? [`kernel ${selection.leafId}`] : []),
    ...(selection.parallelId !== null ? [`parallel ${selection.parallelId}`] : []),
    panel,
  ];
  const entry: CitationDictionaryEntryV2 = {
    token,
    displayLabel: labels.join(' · '),
    target: {
      protocol: 'vibesim.analyzer/v2',
      ...selection,
    },
  };
  return citationDictionarySnapshotV2Schema.parse({
    protocol: 'vibesim.citation-dictionary/v2',
    identity: `prediction-${shortIdentity(`${selection.predictionId}|${token}`)}`,
    document: [
      '## Analyzer citation references',
      '',
      'Use this exact Markdown inline-code reference for the selected timing prediction evidence.',
      `- \`${token}\`: ${entry.displayLabel}`,
    ].join('\n'),
    entries: [entry],
  });
}

function kernelProfileDictionary(
  selection: Extract<AnalyzerSelectionV2, { kind: 'kernel_profile' }>,
): CitationDictionarySnapshotV2 {
  const panel = selection.panelId ?? 'overview';
  const token = [
    'kprof',
    safeSegment(panel),
    ...(selection.metricKey ? [safeSegment(selection.metricKey)] : []),
  ].join('.');
  const entry: CitationDictionaryEntryV2 = {
    token,
    displayLabel: [selection.profileId, panel, selection.metricKey].filter(Boolean).join(' · '),
    target: { protocol: 'vibesim.analyzer/v2', ...selection },
  };
  return citationDictionarySnapshotV2Schema.parse({
    protocol: 'vibesim.citation-dictionary/v2',
    identity: `kernel-profile-${shortIdentity(`${selection.profileId}|${token}`)}`,
    document: [
      '## Analyzer citation references',
      '',
      'Use this exact Markdown inline-code reference for the selected kernel profile evidence.',
      `- \`${token}\`: ${entry.displayLabel}`,
    ].join('\n'),
    entries: [entry],
  });
}

function kernelMeasurementDictionary(
  selection: Extract<AnalyzerSelectionV2, { kind: 'kernel_measurement' }>,
): CitationDictionarySnapshotV2 {
  const panel = selection.panelId ?? 'overview';
  const detail = selection.metricKey ?? selection.plotName;
  const token = [
    'kmeasure',
    safeSegment(panel),
    ...(detail ? [safeSegment(detail)] : []),
  ].join('.');
  const entry: CitationDictionaryEntryV2 = {
    token,
    displayLabel: [selection.measurementId, panel, detail].filter(Boolean).join(' · '),
    target: { protocol: 'vibesim.analyzer/v2', ...selection },
  };
  return citationDictionarySnapshotV2Schema.parse({
    protocol: 'vibesim.citation-dictionary/v2',
    identity: `kernel-measurement-${shortIdentity(`${selection.measurementId}|${token}`)}`,
    document: [
      '## Analyzer citation references',
      '',
      'Use this exact Markdown inline-code reference for the selected kernel measurement evidence.',
      `- \`${token}\`: ${entry.displayLabel}`,
    ].join('\n'),
    entries: [entry],
  });
}

export function analyzerTurnContext(
  selection: AnalyzerSelectionV2 | null,
  analysis?: SweepAnalysis,
): AnalyzerTurnContextV2 | null {
  if (selection === null) return null;
  if (
    selection.kind === 'aggregate' &&
    (!analysis ||
      analysis.workspaceId !== selection.workspaceId ||
      analysis.sweepId !== selection.experimentId)
  ) {
    return null;
  }
  const citationDictionary =
    selection.kind === 'aggregate'
      ? aggregateDictionary(analysis!)
      : selection.kind === 'prediction'
        ? predictionDictionary(selection)
        : selection.kind === 'kernel_profile'
          ? kernelProfileDictionary(selection)
          : selection.kind === 'kernel_measurement'
            ? kernelMeasurementDictionary(selection)
            : runDictionary(selection);
  return analyzerTurnContextV2Schema.parse({
    protocol: 'vibesim.conversation-context/v2',
    selection,
    citationDictionary,
  });
}
