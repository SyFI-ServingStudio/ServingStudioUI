import { Box, ButtonBase, Stack, Typography } from '@mui/material';
import type { EChartsOption } from 'echarts';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useSweepListQuery, useSweepQuery } from '../../application/queries';
import EChart from '../../components/EChart';
import SurfaceCard, { SurfaceAccentProvider } from '../../components/SurfaceCard';
import {
  EvidenceSelectionBadge,
  EvidenceSurfaceCard,
  EvidenceTitleButton,
} from '../../components/EvidenceSurfaceCard';
import WorkspaceNav from '../../components/WorkspaceNav';
import {
  ANALYZER_NAVIGATION_RESULT_EVENT,
  analyzerEvidenceHref,
  evidenceRefFromHash,
  replaceAnalyzerEvidenceHref,
  type AnalyzerNavigationResultV1,
  type EvidenceRefV1,
} from '../../domain/analyzerNavigation';
import type { AggregateAnalyzerSelectionV1 } from '../../domain/analyzerSelection';
import type {
  SweepAnalysis,
  SweepCoordinateValue,
  SweepMetric,
  SweepPrimitive,
} from '../../domain/sweep';
import { useViz } from '../../store';
import { tokens } from '../../theme';
import { metricStatisticLabel, sweepMetricSections, type SweepMetricPanel } from './metricSections';
import ExperimentSelector from './ExperimentSelector';
import SweepHeatmap from './SweepHeatmap';
import {
  formatMetricValue,
  runCoordinateKey,
  sweepChartOption,
  sweepFacets,
  type SweepFacet,
} from './sweepOption';

function StatePanel({ title, detail }: { title: string; detail: string }) {
  return (
    <SurfaceCard sx={{ mt: 2, p: 2.5 }} role="status">
      <Typography component="h2" sx={{ fontFamily: tokens.serif, fontWeight: 600, fontSize: 18 }}>
        {title}
      </Typography>
      <Typography sx={{ mt: 0.5, color: tokens.sub, fontFamily: tokens.mono, fontSize: 10.5 }}>
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
          fontFamily: tokens.mono,
          fontSize: 9,
          letterSpacing: '.14em',
          textTransform: 'uppercase',
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
        background: 'rgba(42,38,34,.035)',
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
              fontFamily: tokens.mono,
              fontSize: 8.5,
              fontWeight: 600,
              letterSpacing: '.08em',
              textTransform: 'uppercase',
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
      sx={{
        p: { xs: 1.3, md: 1.5 },
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
          <Typography sx={{ mt: 0.1, color: tokens.sub, fontFamily: tokens.mono, fontSize: 9 }}>
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
              fontFamily: tokens.mono,
              fontSize: 9,
              letterSpacing: '.1em',
              textTransform: 'uppercase',
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
                    fontFamily: tokens.mono,
                    fontSize: 9,
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

function announceNavigationResult(
  target: EvidenceRefV1,
  status: AnalyzerNavigationResultV1['status'],
) {
  window.dispatchEvent(
    new CustomEvent(ANALYZER_NAVIGATION_RESULT_EVENT, {
      detail: { href: analyzerEvidenceHref(target), status },
    }),
  );
}

function coordinatesMatch(
  coordinates: Readonly<Record<string, unknown>>,
  requested: Readonly<Record<string, unknown>>,
): boolean {
  return Object.entries(requested).every(
    ([axis, value]) => JSON.stringify(coordinates[axis]) === JSON.stringify(value),
  );
}

function copySweepCoordinates(
  coordinates: Readonly<Record<string, SweepCoordinateValue>>,
): NonNullable<AggregateAnalyzerSelectionV1['coordinates']> {
  const copied: NonNullable<AggregateAnalyzerSelectionV1['coordinates']> = {};
  Object.entries(coordinates).forEach(([axis, value]) => {
    copied[axis] = Array.isArray(value) ? [...value] : (value as SweepPrimitive);
  });
  return copied;
}

function aggregateSelectionFromEvidence(target: EvidenceRefV1): AggregateAnalyzerSelectionV1 {
  return {
    kind: 'aggregate',
    experimentId: target.experimentId,
    ...(target.panelId ? { panelId: target.panelId } : {}),
    ...(target.metricKey ? { metricKey: target.metricKey } : {}),
    ...(target.statistic ? { statistic: target.statistic } : {}),
    ...(target.runId ? { runId: target.runId } : {}),
    ...(target.coordinates ? { coordinates: target.coordinates } : {}),
  };
}

function evidenceFromAggregateSelection(selection: AggregateAnalyzerSelectionV1): EvidenceRefV1 {
  return {
    protocol: 'vibesim.analyzer/v1',
    experimentId: selection.experimentId,
    ...(selection.panelId ? { panelId: selection.panelId } : {}),
    ...(selection.metricKey ? { metricKey: selection.metricKey } : {}),
    ...(selection.statistic ? { statistic: selection.statistic } : {}),
    ...(selection.runId ? { runId: selection.runId } : {}),
    ...(selection.coordinates ? { coordinates: selection.coordinates } : {}),
  };
}

export default function SweepPage({ integrated = false }: { integrated?: boolean }) {
  const sweepList = useSweepListQuery();
  const [navigationTarget, setNavigationTarget] = useState<EvidenceRefV1 | null>(() =>
    evidenceRefFromHash(window.location.hash),
  );
  const metricPanelsRef = useRef<HTMLDivElement>(null);
  const panelRefs = useRef(new Map<string, HTMLDivElement>());
  const setRun = useViz((state) => state.setRun);
  const aggregateSelection = useViz((state) => state.aggregateSelection);
  const setAggregateSelection = useViz((state) => state.setAggregateSelection);
  const selectedSweepId = aggregateSelection?.experimentId ?? null;
  const selectedSweep = sweepList.data?.find((sweep) => sweep.sweepId === selectedSweepId) ?? null;

  useEffect(() => {
    const syncNavigationTarget = () =>
      setNavigationTarget(evidenceRefFromHash(window.location.hash));
    window.addEventListener('hashchange', syncNavigationTarget);
    return () => window.removeEventListener('hashchange', syncNavigationTarget);
  }, []);

  useEffect(() => {
    if (!sweepList.data?.length) return;
    if (navigationTarget) {
      const requestedSweep = sweepList.data.find(
        (sweepEntry) => sweepEntry.sweepId === navigationTarget.experimentId,
      );
      if (!requestedSweep) {
        announceNavigationResult(navigationTarget, 'not-found');
        return;
      }
      setAggregateSelection(aggregateSelectionFromEvidence(navigationTarget));
      if (requestedSweep.status === 'pending') {
        announceNavigationResult(navigationTarget, 'unavailable');
      }
      return;
    }
    if (selectedSweepId !== null) return;
    const defaultSweep =
      sweepList.data.find((sweepEntry) => sweepEntry.status === 'ready') ?? sweepList.data[0];
    const defaultSelection: AggregateAnalyzerSelectionV1 = {
      kind: 'aggregate',
      experimentId: defaultSweep.sweepId,
    };
    setAggregateSelection(defaultSelection);
    replaceAnalyzerEvidenceHref({
      protocol: 'vibesim.analyzer/v1',
      experimentId: defaultSweep.sweepId,
    });
  }, [navigationTarget, selectedSweepId, setAggregateSelection, sweepList.data]);

  useEffect(() => {
    document.title = 'VibeSim · Sweep aggregate';
    return () => {
      document.title = 'VibeSim · Run';
    };
  }, []);

  const sweep = useSweepQuery(selectedSweepId, selectedSweep?.status === 'ready');
  const analysis = sweep.data;
  const facets = useMemo(() => (analysis ? sweepFacets(analysis) : []), [analysis]);
  const metricSections = useMemo(
    () => (analysis ? sweepMetricSections(analysis.metrics) : []),
    [analysis],
  );
  const selectedRunKey = useMemo(() => {
    if (!analysis || aggregateSelection?.experimentId !== analysis.sweepId) return null;
    const selectedRun =
      analysis.runs.find((run) => run.runId === aggregateSelection.runId) ??
      (aggregateSelection.coordinates
        ? analysis.runs.find((run) =>
            coordinatesMatch(run.coordinates, aggregateSelection.coordinates ?? {}),
          )
        : undefined);
    return selectedRun ? runCoordinateKey(analysis, selectedRun) : null;
  }, [aggregateSelection, analysis]);
  const selectedPanelId =
    aggregateSelection && aggregateSelection.experimentId === analysis?.sweepId
      ? (aggregateSelection.panelId ?? null)
      : null;

  useEffect(() => {
    if (!navigationTarget || !analysis || analysis.sweepId !== navigationTarget.experimentId) {
      return;
    }
    const panels = metricSections.flatMap((section) => section.panels);
    const requestedPanel =
      panels.find((panel) => panel.id === navigationTarget.panelId) ??
      panels.find((panel) =>
        panel.metrics.some((metric) => metric.key === navigationTarget.metricKey),
      );
    if (
      (navigationTarget.panelId || navigationTarget.metricKey || navigationTarget.statistic) &&
      !requestedPanel
    ) {
      announceNavigationResult(navigationTarget, 'not-found');
      return;
    }
    if (
      navigationTarget.metricKey &&
      !requestedPanel?.metrics.some((metric) => metric.key === navigationTarget.metricKey)
    ) {
      announceNavigationResult(navigationTarget, 'not-found');
      return;
    }
    if (
      navigationTarget.statistic &&
      !requestedPanel?.metrics.some(
        (metric) => metricStatisticLabel(metric)?.toLowerCase() === navigationTarget.statistic,
      )
    ) {
      announceNavigationResult(navigationTarget, 'not-found');
      return;
    }

    const requestedRun =
      analysis.runs.find((run) => run.runId === navigationTarget.runId) ??
      (navigationTarget.coordinates
        ? analysis.runs.find((run) =>
            coordinatesMatch(run.coordinates, navigationTarget.coordinates ?? {}),
          )
        : undefined);
    if ((navigationTarget.runId || navigationTarget.coordinates) && !requestedRun) {
      announceNavigationResult(navigationTarget, 'not-found');
      return;
    }
    setAggregateSelection({
      ...aggregateSelectionFromEvidence(navigationTarget),
      ...(requestedPanel ? { panelId: requestedPanel.id } : {}),
      ...(requestedRun?.runId ? { runId: requestedRun.runId } : {}),
      ...(requestedRun ? { coordinates: copySweepCoordinates(requestedRun.coordinates) } : {}),
    });

    window.requestAnimationFrame(() => {
      if (requestedPanel) {
        const panelElement = panelRefs.current.get(requestedPanel.id);
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        panelElement?.scrollIntoView({
          behavior: reduceMotion ? 'auto' : 'smooth',
          block: 'start',
        });
        panelElement?.focus({ preventScroll: true });
      }
      announceNavigationResult(navigationTarget, 'ok');
    });
  }, [analysis, metricSections, navigationTarget, setAggregateSelection]);

  const selectChartRun = (panel: SweepMetricPanel, event: unknown, metric: SweepMetric) => {
    const data = (
      event as {
        data?: {
          runKey?: unknown;
          runId?: unknown;
          coordinates?: unknown;
        };
      }
    ).data;
    if (typeof data?.runKey !== 'string' || selectedSweepId === null) return;
    const selection: AggregateAnalyzerSelectionV1 = {
      kind: 'aggregate',
      experimentId: selectedSweepId,
      panelId: panel.id,
      metricKey: metric.key,
      ...(metricStatisticLabel(metric)
        ? {
            statistic: metricStatisticLabel(metric)?.toLowerCase() as 'mean' | 'p99',
          }
        : {}),
      ...(typeof data.runId === 'string' ? { runId: data.runId } : {}),
      ...(data.coordinates &&
      typeof data.coordinates === 'object' &&
      !Array.isArray(data.coordinates)
        ? {
            coordinates: data.coordinates as EvidenceRefV1['coordinates'],
          }
        : {}),
    };
    setAggregateSelection(selection);
    replaceAnalyzerEvidenceHref(evidenceFromAggregateSelection(selection));
  };

  const selectMetricPanel = (panel: SweepMetricPanel, metric: SweepMetric) => {
    if (selectedSweepId === null) return;
    const selection: AggregateAnalyzerSelectionV1 = {
      kind: 'aggregate',
      experimentId: selectedSweepId,
      panelId: panel.id,
      metricKey: metric.key,
      ...(aggregateSelection?.experimentId === selectedSweepId && aggregateSelection.runId
        ? { runId: aggregateSelection.runId }
        : {}),
      ...(aggregateSelection?.experimentId === selectedSweepId && aggregateSelection.coordinates
        ? { coordinates: aggregateSelection.coordinates }
        : {}),
      ...(metricStatisticLabel(metric)
        ? {
            statistic: metricStatisticLabel(metric)?.toLowerCase() as 'mean' | 'p99',
          }
        : {}),
    };
    setAggregateSelection(selection);
    replaceAnalyzerEvidenceHref(evidenceFromAggregateSelection(selection));
  };

  const openChartRun = (event: unknown) => {
    const data = (event as { data?: { runId?: unknown } }).data;
    if (typeof data?.runId !== 'string') return;
    setRun(data.runId);
    window.location.hash = '/run';
  };

  const completeRuns =
    analysis?.runs.filter(
      (run) => run.lifecycle.simulation === 'complete' && run.lifecycle.analysis === 'complete',
    ).length ?? 0;
  const singletonRun = selectedSweep?.kind === 'singleton' ? analysis?.runs[0] : undefined;
  const inspectSingleton = () => {
    if (!singletonRun?.runId) return;
    setRun(singletonRun.runId);
    window.location.hash = '/run';
  };
  const activateSweep = (sweepId: string) => {
    setNavigationTarget(null);
    const selection: AggregateAnalyzerSelectionV1 = {
      kind: 'aggregate',
      experimentId: sweepId,
    };
    setAggregateSelection(selection);
    replaceAnalyzerEvidenceHref(evidenceFromAggregateSelection(selection));
    window.requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      metricPanelsRef.current?.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'start',
      });
    });
  };

  return (
    <Box
      component="main"
      sx={{ maxWidth: 1560, mx: 'auto', px: { xs: 2.25, md: 5.5 }, pt: 3.75, pb: 10 }}
    >
      <Box sx={{ borderBottom: `1.5px solid ${tokens.ink}`, pb: 2.5 }}>
        <Stack
          direction="row"
          alignItems="center"
          useFlexGap
          sx={{ gap: 1.5, mb: 1.6, color: tokens.sub }}
        >
          <Typography
            sx={{
              fontFamily: tokens.mono,
              fontSize: 11,
              letterSpacing: '.24em',
              textTransform: 'uppercase',
            }}
          >
            VibeSim Analyzer
          </Typography>
          <Box sx={{ flex: 1, height: '1px', background: tokens.hair }} />
          {!integrated && <WorkspaceNav current="aggregate" />}
        </Stack>
        <Typography
          component="h1"
          sx={{
            fontFamily: tokens.serif,
            fontWeight: 600,
            fontSize: 'clamp(34px,5vw,60px)',
            lineHeight: 0.96,
            letterSpacing: '-.02em',
          }}
        >
          Sweep{' '}
          <Box component="em" sx={{ color: tokens.teal, fontWeight: 500 }}>
            aggregate
          </Box>
        </Typography>
        <Typography
          sx={{ mt: 1.4, maxWidth: 720, color: tokens.sub, fontSize: 13.5, lineHeight: 1.55 }}
        >
          Compare launcher-defined experiment coordinates across throughput, latency, and
          utilization. Membership follows an explicit sweep manifest or one unclaimed singleton run.
        </Typography>
      </Box>

      {sweepList.isPending ? (
        <StatePanel title="Loading sweep index" detail="Waiting for the Analyzer sweep catalog." />
      ) : sweepList.isError ? (
        <StatePanel
          title="Sweep index unavailable"
          detail={
            sweepList.error instanceof Error ? sweepList.error.message : 'Catalog read failed.'
          }
        />
      ) : sweepList.data.length === 0 ? (
        <StatePanel
          title="No aggregate experiments"
          detail="No launcher sweep manifests or standalone runs were found below the configured logs roots."
        />
      ) : (
        <>
          <Box sx={{ mt: integrated ? 1.6 : 2.5 }}>
            {!integrated && (
              <ExperimentSelector
                entries={sweepList.data}
                selectedId={selectedSweepId}
                autoSelectFallback={navigationTarget === null}
                onSelect={(sweepId) => {
                  setNavigationTarget(null);
                  const selection: AggregateAnalyzerSelectionV1 = {
                    kind: 'aggregate',
                    experimentId: sweepId,
                  };
                  setAggregateSelection(selection);
                  replaceAnalyzerEvidenceHref(evidenceFromAggregateSelection(selection));
                }}
                onActivate={activateSweep}
              />
            )}
            {analysis && (
              <Stack
                direction="row"
                justifyContent="flex-end"
                useFlexGap
                flexWrap="wrap"
                sx={{ gap: { xs: 2.5, md: 4 }, mt: integrated ? 0 : 1.4 }}
              >
                <Stat value={String(analysis.runs.length)} label="member runs" />
                <Stat value={String(analysis.axes.length)} label="sweep axes" />
                <Stat
                  value={`${completeRuns}/${analysis.runs.length}`}
                  label="analysis ready"
                  accent
                />
              </Stack>
            )}
          </Box>

          <Box ref={metricPanelsRef} sx={{ scrollMarginTop: 16 }} />
          {selectedSweep?.status === 'pending' ? (
            <StatePanel
              title="Aggregate analysis pending"
              detail="The launcher manifest exists, but sweep_metrics_grid.json has not been generated."
            />
          ) : sweep.isPending ? (
            <StatePanel title="Loading aggregate payload" detail="Reading bounded sweep metrics." />
          ) : sweep.isError ? (
            <StatePanel
              title="Aggregate payload unavailable"
              detail={sweep.error instanceof Error ? sweep.error.message : 'Payload read failed.'}
            />
          ) : analysis ? (
            <SurfaceAccentProvider accent={tokens.sectionAnalysis}>
              <Box component="section" aria-labelledby="aggregate-metric-heading" sx={{ mt: 3 }}>
                <Stack
                  direction="row"
                  alignItems="end"
                  justifyContent="space-between"
                  useFlexGap
                  sx={{ gap: 2, mb: 1.2 }}
                >
                  <Box>
                    <Typography
                      sx={{
                        color: tokens.sectionAnalysis,
                        fontFamily: tokens.mono,
                        fontSize: 9.5,
                        letterSpacing: '.14em',
                      }}
                    >
                      00 · METRIC PANELS
                    </Typography>
                    <Typography
                      id="aggregate-metric-heading"
                      component="h2"
                      sx={{
                        mt: 0.25,
                        fontFamily: tokens.serif,
                        fontSize: 20,
                        fontWeight: 600,
                      }}
                    >
                      Aggregate evidence by outcome
                    </Typography>
                  </Box>
                  {singletonRun?.runId && (
                    <ButtonBase
                      onClick={inspectSingleton}
                      sx={{
                        px: 1.4,
                        py: 0.8,
                        border: `1px solid ${tokens.teal}`,
                        borderRadius: 1.5,
                        color: tokens.teal,
                        fontFamily: tokens.mono,
                        fontSize: 9,
                        fontWeight: 600,
                        letterSpacing: '.08em',
                        textTransform: 'uppercase',
                        '&:hover': { background: 'rgba(31,111,107,.06)' },
                      }}
                    >
                      Inspect run →
                    </ButtonBase>
                  )}
                </Stack>
                <Stack spacing={1.8}>
                  {metricSections.map((section) => (
                    <Box key={section.id}>
                      <Box
                        sx={{
                          mb: 0.65,
                          display: 'flex',
                          alignItems: 'baseline',
                          gap: 1,
                        }}
                      >
                        <Typography
                          component="h3"
                          sx={{ fontFamily: tokens.serif, fontSize: 18, fontWeight: 600 }}
                        >
                          {section.label}
                        </Typography>
                        <Box sx={{ flex: 1, height: '1px', background: tokens.hair }} />
                        <Typography
                          sx={{ color: tokens.sub2, fontFamily: tokens.mono, fontSize: 8.5 }}
                        >
                          {section.panels.length} {section.panels.length === 1 ? 'view' : 'views'}
                        </Typography>
                      </Box>
                      <Box
                        sx={{
                          display: 'grid',
                          gridTemplateColumns: {
                            xs: '1fr',
                            lg: 'repeat(2, minmax(0, 1fr))',
                          },
                          gap: 1.15,
                        }}
                      >
                        {section.panels.map((panel) => (
                          <Box
                            key={`${analysis.sweepId}:${panel.id}`}
                            ref={(node: HTMLDivElement | null) => {
                              if (node) panelRefs.current.set(panel.id, node);
                              else panelRefs.current.delete(panel.id);
                            }}
                            tabIndex={-1}
                            sx={{ minWidth: 0, scrollMarginTop: 16, outline: 'none' }}
                          >
                            <MetricPanelCard
                              analysis={analysis}
                              panel={panel}
                              selectedRunKey={selectedRunKey}
                              selectedForAgent={selectedPanelId === panel.id}
                              requestedMetricKey={
                                selectedPanelId === panel.id
                                  ? aggregateSelection?.metricKey
                                  : undefined
                              }
                              requestedStatistic={
                                selectedPanelId === panel.id
                                  ? aggregateSelection?.statistic
                                  : undefined
                              }
                              facets={facets}
                              onPanelSelect={(metric) => selectMetricPanel(panel, metric)}
                              onMetricChange={(metric) => selectMetricPanel(panel, metric)}
                              onChartClick={(event, metric) => selectChartRun(panel, event, metric)}
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
          ) : null}
        </>
      )}
    </Box>
  );
}
