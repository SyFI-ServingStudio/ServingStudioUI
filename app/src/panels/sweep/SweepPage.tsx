import { pageLayout } from '../../ui/theme/metrics';
import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import type { EChartsOption } from 'echarts';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  sweepAnalysisRef,
  useArtifact,
  type ArtifactResult,
  type SweepAnalysis,
  type SweepCoordinateValue,
  type SweepMetric,
} from '../../artifacts';
import EChart from '../../ui/controls/EChart';
import SurfaceCard, { SurfaceAccentProvider } from '../../ui/controls/SurfaceCard';
import {
  EvidenceSelectionBadge,
  EvidenceSurfaceCard,
  EvidenceTitleButton,
} from '../../ui/controls/EvidenceSurfaceCard';
import { segmentOf, selectSegment, withOption, withPanel, withPath } from '../../location';
import type { PanelProps } from '../types';
import { tokens, withAlpha } from '../../ui/theme';
import { metricStatisticLabel, sweepMetricSections, type SweepMetricPanel } from './metricSections';
import SweepHeatmap from './SweepHeatmap';
import {
  formatMetricValue,
  runCoordinateKey,
  sweepChartOption,
  sweepFacets,
  type SweepFacet,
} from './option';

function StatePanel({ title, detail }: { title: string; detail: string }) {
  return (
    <SurfaceCard sx={{ mt: 2, p: 2.5 }} role="status">
      <Typography component="h2" sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 18 }}>
        {title}
      </Typography>
      <Typography sx={{ mt: 0.5, color: tokens.sub, fontFamily: tokens.body, fontSize: 12 }}>
        {detail}
      </Typography>
    </SurfaceCard>
  );
}

function Stat({
  value,
  label,
  accent = false,
}: {
  value: string;
  label: string;
  accent?: boolean;
}) {
  return (
    <Box>
      <Typography
        sx={{
          color: accent ? tokens.teal : tokens.ink,
          fontFamily: tokens.serif,
          fontSize: { xs: 25, md: 34 },
          fontWeight: 600,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </Typography>
      <Typography
        sx={{
          mt: 0.65,
          color: tokens.sub,
          fontFamily: tokens.body,
          fontSize: 12,
          letterSpacing: '.02em',
          textTransform: 'none',
        }}
      >
        {label}
      </Typography>
    </Box>
  );
}

function StatisticKnob({
  metrics,
  selectedMetric,
  onChange,
}: {
  metrics: readonly SweepMetric[];
  selectedMetric: SweepMetric;
  onChange: (metricKey: string) => void;
}) {
  if (metrics.length < 2) return null;
  return (
    <Box
      role="group"
      aria-label={`${selectedMetric.group} statistic`}
      sx={{
        display: 'inline-flex',
        p: '2px',
        border: `1px solid ${tokens.hair}`,
        borderRadius: 999,
        background: `${withAlpha(tokens.ink, 0.035)}`,
      }}
    >
      {metrics.map((metric) => {
        const selected = metric.key === selectedMetric.key;
        return (
          <ButtonBase
            key={metric.key}
            aria-pressed={selected}
            onClick={() => onChange(metric.key)}
            sx={{
              minWidth: 44,
              px: 1.05,
              py: 0.45,
              borderRadius: 999,
              background: selected ? tokens.ink : 'transparent',
              color: selected ? tokens.tile : tokens.sub,
              fontFamily: tokens.body,
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '.08em',
              textTransform: 'none',
              transition: `background 160ms ${tokens.ease}, color 160ms ${tokens.ease}`,
              '&:focus-visible': { outline: `2px solid ${tokens.teal}`, outlineOffset: 1 },
            }}
          >
            {metricStatisticLabel(metric) ?? metric.label}
          </ButtonBase>
        );
      })}
    </Box>
  );
}

const StableSweepChart = memo(function StableSweepChart({
  option,
  ariaLabel,
  onEvents,
  height,
}: {
  option: EChartsOption;
  ariaLabel: string;
  onEvents: Readonly<Record<string, (event: unknown) => void>>;
  height: number;
}) {
  return <EChart option={option} ariaLabel={ariaLabel} onEvents={onEvents} style={{ height }} />;
});

function MetricPanelCard({
  analysis,
  panel,
  selectedRunKey,
  selectedForAgent,
  requestedMetricKey,
  requestedStatistic,
  facets,
  onPanelSelect,
  onMetricChange,
  onChartClick,
  onChartDoubleClick,
}: {
  analysis: SweepAnalysis;
  panel: SweepMetricPanel;
  selectedRunKey: string | null;
  selectedForAgent: boolean;
  requestedMetricKey?: string;
  requestedStatistic?: 'mean' | 'p99';
  facets: readonly SweepFacet[];
  onPanelSelect: (metric: SweepMetric) => void;
  onMetricChange: (metric: SweepMetric) => void;
  onChartClick: (event: unknown, metric: SweepMetric) => void;
  onChartDoubleClick: (event: unknown) => void;
}) {
  const [selectedMetricKey, setSelectedMetricKey] = useState<string>();
  useEffect(() => {
    const requestedMetric =
      panel.metrics.find((metric) => metric.key === requestedMetricKey) ??
      panel.metrics.find(
        (metric) => metricStatisticLabel(metric)?.toLowerCase() === requestedStatistic,
      );
    if (requestedMetric) setSelectedMetricKey(requestedMetric.key);
  }, [panel.metrics, requestedMetricKey, requestedStatistic]);
  // sweepMetricSections only creates panels from at least one descriptor.
  const selectedMetric =
    panel.metrics.find((metric) => metric.key === selectedMetricKey) ?? panel.metrics[0]!;
  const singletonRun = analysis.axes.length === 0 ? analysis.runs[0] : undefined;
  const onChartClickRef = useRef(onChartClick);
  const onChartDoubleClickRef = useRef(onChartDoubleClick);
  onChartClickRef.current = onChartClick;
  onChartDoubleClickRef.current = onChartDoubleClick;
  const chartEvents = useMemo(
    () => ({
      click: (event: unknown) => onChartClickRef.current(event, selectedMetric),
      dblclick: (event: unknown) => onChartDoubleClickRef.current(event),
    }),
    [selectedMetric],
  );
  const selectHeatmapCell = useCallback(
    (event: unknown) => onChartClickRef.current(event, selectedMetric),
    [selectedMetric],
  );
  const openHeatmapCell = useCallback((event: unknown) => onChartDoubleClickRef.current(event), []);
  const facetCharts = useMemo(
    () =>
      facets.map((facet) => ({
        facet,
        option:
          analysis.axes.length === 1
            ? sweepChartOption(analysis, selectedMetric, facet, selectedRunKey)
            : null,
        ariaLabel: `${selectedMetric.label} by ${analysis.axes.join(' and ')}${
          facets.length > 1 ? `, ${facet.label}` : ''
        }`,
      })),
    [analysis, facets, selectedMetric, selectedRunKey],
  );
  return (
    <EvidenceSurfaceCard
      evidenceId={panel.id}
      selectedForAgent={selectedForAgent}
      onEvidenceSelect={() => onPanelSelect(selectedMetric)}
      onClickCapture={(event) => {
        if ((event.target as Element).closest('[data-sweep-run]')) event.preventDefault();
      }}
      sx={{
        p: { xs: 2, md: 2.5 },
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        useFlexGap
        sx={{ gap: 1.2, px: 0.4 }}
      >
        <Box>
          <Typography
            component="h4"
            sx={{ fontFamily: tokens.serif, fontSize: 17, fontWeight: 600 }}
          >
            <EvidenceTitleButton label={panel.label}>{panel.label}</EvidenceTitleButton>
          </Typography>
          <Typography sx={{ mt: 0.1, color: tokens.sub, fontFamily: tokens.body, fontSize: 12 }}>
            {selectedMetric.unit}
          </Typography>
        </Box>
        <Stack direction="row" alignItems="center" useFlexGap sx={{ gap: 0.8 }}>
          {selectedForAgent && <EvidenceSelectionBadge />}
          <StatisticKnob
            metrics={panel.metrics}
            selectedMetric={selectedMetric}
            onChange={(metricKey) => {
              setSelectedMetricKey(metricKey);
              const metric = panel.metrics.find((candidate) => candidate.key === metricKey);
              if (metric) onMetricChange(metric);
            }}
          />
        </Stack>
      </Stack>
      {singletonRun ? (
        <Box
          sx={{
            minHeight: 150,
            display: 'grid',
            alignContent: 'center',
            px: 0.4,
            borderTop: `1px solid ${tokens.hair}`,
            mt: 1.2,
          }}
        >
          <Typography
            sx={{
              color: tokens.ink,
              fontFamily: tokens.serif,
              fontSize: 'clamp(34px, 4vw, 48px)',
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '-.025em',
            }}
          >
            {formatMetricValue(selectedMetric, singletonRun.metrics[selectedMetric.key])}
          </Typography>
          <Typography
            sx={{
              mt: 0.4,
              color: tokens.sub,
              fontFamily: tokens.body,
              fontSize: 12,
              letterSpacing: '.1em',
              textTransform: 'none',
            }}
          >
            Single-run aggregate
          </Typography>
        </Box>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns:
              facets.length > 1 ? { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' } : '1fr',
            gap: 1,
          }}
        >
          {facetCharts.map(({ facet, option, ariaLabel }) => (
            <Box key={facet.key} sx={{ minWidth: 0 }}>
              {facets.length > 1 && (
                <Typography
                  sx={{
                    mt: 0.8,
                    px: 0.4,
                    color: tokens.sub,
                    fontFamily: tokens.body,
                    fontSize: 12,
                  }}
                >
                  {facet.label}
                </Typography>
              )}
              {analysis.axes.length >= 2 ? (
                <SweepHeatmap
                  analysis={analysis}
                  metric={selectedMetric}
                  facet={facet}
                  selectedRunKey={selectedRunKey}
                  ariaLabel={ariaLabel}
                  height={facets.length > 1 ? 258 : 280}
                  onCellClick={selectHeatmapCell}
                  onCellDoubleClick={openHeatmapCell}
                />
              ) : (
                option && (
                  <StableSweepChart
                    option={option}
                    ariaLabel={ariaLabel}
                    onEvents={chartEvents}
                    height={facets.length > 1 ? 258 : 280}
                  />
                )
              )}
            </Box>
          ))}
        </Box>
      )}
    </EvidenceSurfaceCard>
  );
}

function resultReason(result: ArtifactResult<unknown>): string {
  return 'reason' in result
    ? (result.reason ?? 'Aggregate payload unavailable.')
    : 'Aggregate payload unavailable.';
}

interface SweepMemberEvent {
  readonly runId?: string;
  readonly coordinates: Readonly<Record<string, SweepCoordinateValue>>;
}

function eventMember(event: unknown): SweepMemberEvent | null {
  let value = event;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof value !== 'object' || value === null) return null;
    const record = value as { runId?: unknown; coordinates?: unknown; data?: unknown };
    if (
      typeof record.coordinates === 'object' &&
      record.coordinates !== null &&
      !Array.isArray(record.coordinates)
    ) {
      return {
        ...(typeof record.runId === 'string' ? { runId: record.runId } : {}),
        coordinates: record.coordinates as Readonly<Record<string, SweepCoordinateValue>>,
      };
    }
    value = record.data;
  }
  return null;
}

function coordinatesMatch(
  left: Readonly<Record<string, SweepCoordinateValue>>,
  right: Readonly<Record<string, SweepCoordinateValue>>,
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (axis, index) =>
        axis === rightKeys[index] && JSON.stringify(left[axis]) === JSON.stringify(right[axis]),
    )
  );
}

// A panel-mode selection remounts this component when it changes the default
// sweep page into `panel=sweep.page`. Keep the one pending internal address
// outside the component so that remount cannot turn an ordinary click into a
// citation-style scroll.
let suppressScrollForFocus: string | null = null;

function focusIdentity(focus: PanelProps['location']['focus']): string {
  const path = focus.path.map((segment) =>
    segment.at === 'run' && segment.coordinates !== undefined
      ? {
          ...segment,
          coordinates: Object.fromEntries(
            Object.keys(segment.coordinates)
              .sort()
              .map((axis) => [axis, segment.coordinates![axis]]),
          ),
        }
      : segment,
  );
  return JSON.stringify([
    path,
    focus.cursorMs,
    focus.panel,
    Object.entries(focus.options).sort(([left], [right]) => left.localeCompare(right)),
  ]);
}

function memberMatches(
  run: SweepAnalysis['runs'][number],
  member: Extract<ReturnType<typeof segmentOf>, { at: 'run' }>,
): boolean {
  return (
    (member.id === undefined || run.runId === member.id) &&
    (member.coordinates === undefined || coordinatesMatch(run.coordinates, member.coordinates))
  );
}

export function SweepPage(props: PanelProps) {
  if (props.location.ref.kind !== 'sweep') return null;
  return <SweepContent {...props} result={{ ...props.location.ref, kind: 'sweep' as const }} />;
}

function SweepContent({
  location,
  navigate,
  result,
}: PanelProps & {
  readonly result: PanelProps['location']['ref'] & { readonly kind: 'sweep' };
}) {
  const sweep = useArtifact(sweepAnalysisRef(result));
  const analysis = sweep.status === 'ready' ? sweep.value : null;
  const facets = useMemo(() => (analysis ? sweepFacets(analysis) : []), [analysis]);
  const metricSections = useMemo(
    () => (analysis ? sweepMetricSections(analysis.metrics) : []),
    [analysis],
  );
  const panels = useMemo(
    () => metricSections.flatMap((section) => section.panels),
    [metricSections],
  );
  const selectedMember = segmentOf(location.focus.path, 'run');
  const selectedRun =
    selectedMember === null
      ? undefined
      : analysis?.runs.find((run) => memberMatches(run, selectedMember));
  const selectedRunKey = analysis && selectedRun ? runCoordinateKey(analysis, selectedRun) : null;
  const selectedMetricKey = location.focus.options.metric;
  const selectedEvidencePanel = location.focus.options['evidence-panel'];
  const selectedPanel =
    panels.find((panel) => panel.id === selectedEvidencePanel) ??
    panels.find((panel) => panel.metrics.some((metric) => metric.key === selectedMetricKey));
  const panelRefs = useRef(new Map<string, HTMLElement>());
  const selectedFocusIdentity = focusIdentity(location.focus);

  useEffect(() => {
    const panelId = selectedEvidencePanel;
    if (!analysis || !panelId || !panels.some((panel) => panel.id === panelId)) return;
    if (suppressScrollForFocus === selectedFocusIdentity) {
      // StrictMode runs mount effects twice in development. Clear after both
      // passes so the second pass cannot reinterpret this click as a restore.
      window.requestAnimationFrame(() => {
        if (suppressScrollForFocus === selectedFocusIdentity) suppressScrollForFocus = null;
      });
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      const element = panelRefs.current.get(panelId);
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      element?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      element?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [analysis, selectedEvidencePanel, selectedFocusIdentity, panels]);

  const updateSelection = useCallback(
    (panelId: string, metric: SweepMetric, member?: SweepMemberEvent) => {
      let focus = withPanel(location.focus, 'sweep.page');
      focus = withOption(focus, 'evidence-panel', panelId);
      focus = withOption(focus, 'metric', metric.key);
      const statistic = metricStatisticLabel(metric)?.toLowerCase();
      focus = withOption(focus, 'stat', statistic ?? null);
      if (member !== undefined) {
        focus = withPath(focus, []);
        focus = selectSegment(focus, {
          at: 'run',
          ...(member.runId === undefined ? {} : { id: member.runId }),
          coordinates: member.coordinates,
        });
      }
      const next = { ...location, focus };
      const nextIdentity = focusIdentity(focus);
      if (nextIdentity !== focusIdentity(location.focus)) suppressScrollForFocus = nextIdentity;
      navigate(next, 'replace');
    },
    [location, navigate],
  );

  const selectChartRun = (panelId: string, metric: SweepMetric, event: unknown) => {
    const member = eventMember(event);
    if (member) updateSelection(panelId, metric, member);
  };
  const openChartRun = (event: unknown) => {
    const runId = eventMember(event)?.runId;
    if (runId === undefined) return;
    navigate(
      {
        view: 'result',
        ref: { kind: 'run', id: runId, workspace: location.ref.workspace },
        focus: { path: [], cursorMs: null, panel: null, options: {} },
        chat: location.chat,
      },
      'push',
    );
  };

  const completeRuns =
    analysis?.runs.filter(
      (run) => run.lifecycle.simulation === 'complete' && run.lifecycle.analysis === 'complete',
    ).length ?? 0;
  const singletonRun = analysis?.axes.length === 0 ? analysis.runs[0] : undefined;

  return (
    <Box component="main" sx={{ ...pageLayout, mx: 'auto', px: 0, pt: 4, pb: 10 }}>
      <Box sx={{ borderBottom: `1px solid ${tokens.hair}`, pb: 2.5 }}>
        <Stack
          direction="row"
          alignItems="center"
          useFlexGap
          sx={{ gap: 1.5, mb: 1.6, color: tokens.sub }}
        >
          <Typography
            sx={{
              fontFamily: tokens.body,
              fontSize: 12,
              letterSpacing: '.03em',
              textTransform: 'none',
            }}
          >
            ServingStudio Analyzer
          </Typography>
          <Box sx={{ flex: 1, height: '1px', background: tokens.hair }} />
        </Stack>
        <Typography
          component="h1"
          sx={{
            fontFamily: tokens.serif,
            fontWeight: 600,
            fontSize: 'clamp(30px,3vw,40px)',
            lineHeight: 1.15,
            letterSpacing: '-.02em',
          }}
        >
          Sweep{' '}
          <Box component="span" sx={{ color: tokens.ink, fontWeight: 600 }}>
            aggregate
          </Box>
        </Typography>
        <Typography
          sx={{ mt: 1.4, maxWidth: 720, color: tokens.sub, fontSize: 13.5, lineHeight: 1.55 }}
        >
          Compare throughput, latency, and utilization across your experiment.
        </Typography>
      </Box>

      {sweep.status === 'pending' ? (
        <StatePanel title="Loading aggregate payload" detail="Reading bounded sweep metrics." />
      ) : sweep.status !== 'ready' ? (
        <StatePanel title="Aggregate payload unavailable" detail={resultReason(sweep)} />
      ) : analysis ? (
        <>
          <Box sx={{ mt: 1.6 }}>
            <Stack
              direction="row"
              justifyContent="flex-start"
              useFlexGap
              flexWrap="wrap"
              sx={{ gap: { xs: 3, md: 6 }, mt: 1, py: 1.5 }}
            >
              <Stat value={String(analysis.runs.length)} label="member runs" />
              <Stat value={String(analysis.axes.length)} label="sweep axes" />
              <Stat
                value={`${completeRuns}/${analysis.runs.length}`}
                label="analysis ready"
                accent
              />
            </Stack>
          </Box>
          <SurfaceAccentProvider accent={tokens.sectionAnalysis}>
            <Box component="section" aria-labelledby="aggregate-metric-heading" sx={{ mt: 3 }}>
              <Stack
                direction="row"
                alignItems="end"
                justifyContent="space-between"
                useFlexGap
                sx={{ gap: 2, mb: 1.2 }}
              >
                <Typography
                  id="aggregate-metric-heading"
                  component="h2"
                  sx={{ mt: 0.25, fontFamily: tokens.serif, fontSize: 20, fontWeight: 600 }}
                >
                  Performance breakdown
                </Typography>
                {singletonRun?.runId && (
                  <ButtonBase
                    onClick={() => openChartRun({ data: { runId: singletonRun.runId } })}
                    sx={{
                      px: 1.4,
                      py: 0.8,
                      border: `1px solid ${tokens.teal}`,
                      borderRadius: 1.5,
                      color: tokens.teal,
                      fontFamily: tokens.body,
                      fontSize: 12,
                      fontWeight: 600,
                      letterSpacing: '.08em',
                      textTransform: 'none',
                      '&:hover': { background: withAlpha(tokens.teal, 0.06) },
                    }}
                  >
                    Inspect run →
                  </ButtonBase>
                )}
              </Stack>
              <Stack spacing={3}>
                {metricSections.map((section) => (
                  <Box key={section.id}>
                    <Box sx={{ mb: 0.65, display: 'flex', alignItems: 'baseline', gap: 1 }}>
                      <Typography
                        component="h3"
                        sx={{ fontFamily: tokens.serif, fontSize: 18, fontWeight: 600 }}
                      >
                        {section.label}
                      </Typography>
                      <Box sx={{ flex: 1, height: '1px', background: tokens.hair }} />
                      <Typography
                        sx={{ color: tokens.sub2, fontFamily: tokens.body, fontSize: 12 }}
                      >
                        {section.panels.length} {section.panels.length === 1 ? 'view' : 'views'}
                      </Typography>
                    </Box>
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' },
                        gap: 1.15,
                      }}
                    >
                      {section.panels.map((panel) => (
                        <Box
                          key={`${analysis.sweepId}:${panel.id}`}
                          data-sweep-panel={panel.id}
                          ref={(element: HTMLElement | null) => {
                            if (element) panelRefs.current.set(panel.id, element);
                            else panelRefs.current.delete(panel.id);
                          }}
                          tabIndex={-1}
                          sx={{ minWidth: 0, scrollMarginTop: 16, outline: 'none' }}
                        >
                          <MetricPanelCard
                            analysis={analysis}
                            panel={panel}
                            selectedRunKey={selectedRunKey}
                            selectedForAgent={selectedPanel?.id === panel.id}
                            requestedMetricKey={
                              selectedPanel?.id === panel.id ? selectedMetricKey : undefined
                            }
                            requestedStatistic={
                              selectedPanel?.id === panel.id &&
                              (location.focus.options.stat === 'mean' ||
                                location.focus.options.stat === 'p99')
                                ? location.focus.options.stat
                                : undefined
                            }
                            facets={facets}
                            onPanelSelect={(metric) => updateSelection(panel.id, metric)}
                            onMetricChange={(metric) => updateSelection(panel.id, metric)}
                            onChartClick={(event, metric) =>
                              selectChartRun(panel.id, metric, event)
                            }
                            onChartDoubleClick={openChartRun}
                          />
                        </Box>
                      ))}
                    </Box>
                  </Box>
                ))}
              </Stack>
            </Box>
          </SurfaceAccentProvider>
        </>
      ) : null}
    </Box>
  );
}
